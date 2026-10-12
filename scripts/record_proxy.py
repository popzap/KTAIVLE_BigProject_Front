#!/usr/bin/env python3
"""녹화 프록시 — 프런트가 백엔드에 보내는 요청과 응답을 그대로 적는다.

    브라우저 → Next dev(:3000) → [이 프록시 :8001] → 백엔드(:8000)

포트폴리오 데모(백엔드 없음)가 재생할 **실제 실행 기록**을 만들기 위한 도구다.
값을 만들거나 고치지 않는다. 바꾸는 것은 마스킹 대상(토큰·비밀번호·쿠키)뿐이고,
바꾼 자리에는 `***MASKED***` 를 남긴다.

사용:
    python scripts/record_proxy.py --out demo-recording/_session
    # .env.local: OMNISITE_API_ORIGIN=http://127.0.0.1:8001  →  npm run dev

    화면 번호는 프록시가 알 수 없으므로 진행하는 사람이 알려 준다:
    curl "http://127.0.0.1:8001/__rec/screen?n=2"
    (`/__rec/` 경로는 백엔드로 넘기지 않고 manifest 에도 적지 않는다)

    녹화 파일에 남기면 안 되는 값(데모 계정 이메일 등)은 환경변수로 넘긴다 —
    스크립트나 명령줄 기록에 값이 남지 않게:
    REC_REDACT="a@b.c,다른값" python scripts/record_proxy.py ...

저장 형식 (`--out` 아래):
    manifest.json             녹화 순서(요청 도착 순) 목록
    responses/NNN_<요약>.<ext> 일반 응답 본문. 바이너리는 원래 확장자
    requests/NNN_<요약>.<ext>  요청 본문(있을 때만)
    sse/NNN_<요약>.jsonl       SSE 이벤트. 한 줄에 {t_ms, event, data[, id][, comment]}
                              t_ms 는 **첫 패킷부터의** 경과 시간(ms)

🔴 업스트림에 `Accept-Encoding` 을 넘기지 않는다 — 압축된 본문은 읽을 수도,
   마스킹 검사도 할 수 없다. 브라우저가 받는 내용은 같다(압축만 빠진다).
🔴 바인딩은 127.0.0.1 만 받는다. 0.0.0.0 은 열지 않는다.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import http.client
import http.server
import json
import os
import re
import socketserver
import sys
import threading
import time
import urllib.parse
from pathlib import Path

MASK = "***MASKED***"

# 응답·요청을 그대로 넘기면 안 되는 홉 단위 헤더(RFC 7230 §6.1)
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
}

# JSON 키 이름으로 가리는 값. 어디에 나와도 가린다.
# ⚠ `token` 단독은 넣지 않는다 — 토론 스트림이 토큰 조각을 `token` 같은 키로
#   보낼 수 있어서, 이름만으로 가리면 녹화 본문이 조용히 비게 된다.
SECRET_KEYS = re.compile(
    r"^(password|password_confirm|new_password|current_password|"
    r"access_token|refresh_token|id_token|authorization|cookie|set-cookie|"
    r"api_key|apikey|secret|secret_key|client_secret|openai_api_key)$",
    re.IGNORECASE,
)
# /auth/ 경로에서는 계정 식별자도 가린다(데모 계정 정보를 녹화에 남기지 않는다).
AUTH_IDENTITY_KEYS = re.compile(r"^(email|username|login_id|user_email|nickname|name)$",
                                re.IGNORECASE)

TEXT_PATTERNS = [
    (re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=-]+", re.IGNORECASE), r"\1" + MASK),
    # JWT (header.payload.signature)
    (re.compile(r"eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}"), MASK),
    # OpenAI 키 모양
    (re.compile(r"sk-[A-Za-z0-9_-]{20,}"), MASK),
]
QUERY_SECRET = re.compile(r"(token|access_token|refresh_token|password|api_key)", re.IGNORECASE)


def _redact_literals() -> list[str]:
    raw = os.environ.get("REC_REDACT", "")
    return [v for v in (s.strip() for s in raw.split(",")) if v]


REDACT = _redact_literals()


def mask_text(s: str) -> str:
    for pat, rep in TEXT_PATTERNS:
        s = pat.sub(rep, s)
    for lit in REDACT:
        s = s.replace(lit, MASK)
    return s


def mask_json(obj, *, auth_path: bool):
    """키 이름으로 가린다. 바뀐 게 있는지 같이 돌려준다."""
    changed = False

    def walk(o):
        nonlocal changed
        if isinstance(o, dict):
            out = {}
            for k, v in o.items():
                if isinstance(k, str) and (SECRET_KEYS.match(k)
                                           or (auth_path and AUTH_IDENTITY_KEYS.match(k))):
                    if v not in (None, ""):
                        changed = True
                        out[k] = MASK
                    else:
                        out[k] = v
                else:
                    out[k] = walk(v)
            return out
        if isinstance(o, list):
            return [walk(x) for x in o]
        return o

    return walk(obj), changed


def mask_body(raw: bytes, content_type: str, *, auth_path: bool) -> bytes:
    """텍스트 본문만 가린다. 바이너리는 그대로 둔다."""
    ct = (content_type or "").lower()
    if not _is_text(ct):
        return raw
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw
    if "json" in ct:
        try:
            obj = json.loads(text)
        except ValueError:
            obj = None
        if obj is not None:
            masked, changed = mask_json(obj, auth_path=auth_path)
            if changed:
                # 바뀐 게 있을 때만 다시 쓴다 — 아니면 원문 바이트를 지킨다
                text = json.dumps(masked, ensure_ascii=False)
    elif "x-www-form-urlencoded" in ct:
        pairs = urllib.parse.parse_qsl(text, keep_blank_values=True)
        text = urllib.parse.urlencode(
            [(k, MASK if (SECRET_KEYS.match(k) or (auth_path and AUTH_IDENTITY_KEYS.match(k))) else v)
             for k, v in pairs])
    return mask_text(text).encode("utf-8")


def mask_query(path: str) -> str:
    parts = urllib.parse.urlsplit(path)
    if not parts.query:
        return mask_text(path)
    q = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    q = [(k, MASK if QUERY_SECRET.search(k) else v) for k, v in q]
    return mask_text(urllib.parse.urlunsplit(
        ("", "", parts.path, urllib.parse.urlencode(q, safe="/:"), "")))


def _is_text(ct: str) -> bool:
    return (ct.startswith("text/") or "json" in ct or "xml" in ct
            or "javascript" in ct or "x-www-form-urlencoded" in ct or "csv" in ct)


EXT_BY_CT = [
    ("application/geo+json", ".geojson"),
    ("json", ".json"),
    ("text/csv", ".csv"),
    ("text/event-stream", ".txt"),
    ("text/html", ".html"),
    ("text/plain", ".txt"),
    ("application/pdf", ".pdf"),
    ("application/hwp+zip", ".hwpx"),
    ("image/png", ".png"),
    ("image/jpeg", ".jpg"),
    ("application/zip", ".zip"),
]


def ext_for(ct: str, disposition: str | None) -> str:
    if disposition:
        m = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", disposition, re.IGNORECASE)
        if m:
            suf = Path(urllib.parse.unquote(m.group(1))).suffix
            if suf:
                return suf.lower()
    ct = (ct or "").lower()
    for key, ext in EXT_BY_CT:
        if key in ct:
            return ext
    return ".bin"


def summarize(method: str, path: str) -> str:
    p = urllib.parse.urlsplit(path).path
    p = re.sub(r"^/api/v1/", "", p)
    segs = []
    for seg in p.split("/"):
        seg = urllib.parse.unquote(seg)
        if not seg:
            continue
        if sum(c.isdigit() for c in seg) >= 4:   # run_id·parcel_id 같은 식별자
            continue
        seg = re.sub(r"[^A-Za-z0-9_.-]", "", seg)
        if seg:
            segs.append(seg)
    s = "_".join(segs) or "root"
    return f"{method.lower()}_{s}"[:70]


class SSEParser:
    """바이트 조각을 받아 이벤트 블록(빈 줄로 끝나는 것)을 꺼낸다."""

    def __init__(self):
        self.buf = ""

    def feed(self, chunk: str) -> list[dict]:
        self.buf += chunk.replace("\r\n", "\n").replace("\r", "\n")
        out = []
        while "\n\n" in self.buf:
            block, self.buf = self.buf.split("\n\n", 1)
            ev = self._parse(block)
            if ev is not None:
                out.append(ev)
        return out

    def flush(self) -> list[dict]:
        rest, self.buf = self.buf, ""
        ev = self._parse(rest) if rest.strip() else None
        return [ev] if ev else []

    @staticmethod
    def _parse(block: str) -> dict | None:
        event = None
        data: list[str] = []
        ev_id = None
        retry = None
        comments: list[str] = []
        for line in block.split("\n"):
            if line == "":
                continue
            if line.startswith(":"):
                comments.append(line[1:].lstrip())
                continue
            field, _, value = line.partition(":")
            if value.startswith(" "):
                value = value[1:]
            if field == "event":
                event = value
            elif field == "data":
                data.append(value)
            elif field == "id":
                ev_id = value
            elif field == "retry":
                retry = value
        if not data and event is None and ev_id is None and not comments and retry is None:
            return None
        rec: dict = {"event": event, "data": "\n".join(data) if data else None}
        if ev_id is not None:
            rec["id"] = ev_id
        if retry is not None:
            rec["retry"] = retry
        if comments:
            rec["comment"] = "\n".join(comments)
        return rec


class Recorder:
    def __init__(self, out: Path, upstream: str):
        self.out = out
        self.upstream = upstream
        for sub in ("responses", "requests", "sse"):
            (out / sub).mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.next_index = 1
        self.entries: dict[int, dict] = {}
        self.screen: str | None = None
        self.started_wall = _dt.datetime.now().astimezone()
        self.started_mono = time.monotonic()
        self.meta_extra: dict = {}

    def begin(self) -> tuple[int, str | None]:
        with self.lock:
            i = self.next_index
            self.next_index += 1
            return i, self.screen

    def set_screen(self, n: str | None):
        with self.lock:
            self.screen = n

    def t(self) -> int:
        return int((time.monotonic() - self.started_mono) * 1000)

    def write_file(self, sub: str, name: str, data: bytes) -> str:
        rel = f"{sub}/{name}"
        (self.out / rel).write_bytes(data)
        return rel

    def commit(self, entry: dict):
        with self.lock:
            self.entries[entry["index"]] = entry
            self._flush_locked()

    def _flush_locked(self):
        doc = {
            "recorded_at": self.started_wall.isoformat(timespec="seconds"),
            "upstream": self.upstream,
            "count": len(self.entries),
            **self.meta_extra,
            "entries": [self.entries[k] for k in sorted(self.entries)],
        }
        tmp = self.out / "manifest.json.tmp"
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.out / "manifest.json")


def make_handler(rec: Recorder, up_host: str, up_port: int):
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "record-proxy"

        def log_message(self, fmt, *args):  # 콘솔에는 한 줄 요약만
            sys.stderr.write("[proxy] " + (fmt % args) + "\n")

        # ── 제어 경로 ────────────────────────────────────────────
        def _control(self) -> bool:
            if not self.path.startswith("/__rec/"):
                return False
            u = urllib.parse.urlsplit(self.path)
            q = dict(urllib.parse.parse_qsl(u.query))
            if u.path == "/__rec/screen":
                rec.set_screen(q.get("n"))
                body = {"screen": rec.screen}
            elif u.path == "/__rec/status":
                with rec.lock:
                    body = {"screen": rec.screen, "recorded": len(rec.entries),
                            "next_index": rec.next_index}
            else:
                body = {"error": "unknown control path"}
            raw = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return True

        def _read_request_body(self) -> bytes:
            te = (self.headers.get("Transfer-Encoding") or "").lower()
            if "chunked" in te:
                chunks = []
                while True:
                    size_line = self.rfile.readline().strip()
                    size = int(size_line.split(b";")[0], 16)
                    if size == 0:
                        while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                            pass
                        break
                    chunks.append(self.rfile.read(size))
                    self.rfile.readline()
                return b"".join(chunks)
            n = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(n) if n else b""

        def _write_chunk(self, data: bytes):
            if not data:
                return
            self.wfile.write(f"{len(data):X}\r\n".encode() + data + b"\r\n")
            self.wfile.flush()

        # ── 본체 ────────────────────────────────────────────────
        def _proxy(self):
            if self._control():
                return
            index, screen = rec.begin()
            t_start = rec.t()
            mono0 = time.monotonic()
            method = self.command
            req_body = self._read_request_body()
            req_ct = self.headers.get("Content-Type", "")
            auth_path = "/auth/" in self.path
            summary = summarize(method, self.path)
            referer = self.headers.get("Referer")
            page = urllib.parse.urlsplit(referer).path if referer else None

            entry: dict = {
                "index": index,
                "method": method,
                "path": mask_query(self.path),
                "screen": screen,
                "page": page,
                "t_start_ms": t_start,
                "had_authorization": bool(self.headers.get("Authorization")),
            }

            if req_body:
                entry["request_content_type"] = req_ct or None
                entry["request_bytes"] = len(req_body)
                if "multipart/form-data" in req_ct.lower():
                    # 업로드 본문(파일)은 녹화하지 않는다 — 크기만 남긴다
                    entry["request_file"] = None
                    entry["request_note"] = "multipart 본문은 저장하지 않음"
                else:
                    masked = mask_body(req_body, req_ct, auth_path=auth_path)
                    ext = ".json" if "json" in req_ct.lower() else ext_for(req_ct, None)
                    entry["request_file"] = rec.write_file(
                        "requests", f"{index:03d}_{summary}{ext}", masked)

            fwd = {}
            for k, v in self.headers.items():
                lk = k.lower()
                if lk in HOP_BY_HOP or lk in ("host", "accept-encoding", "content-length"):
                    continue
                fwd[k] = v
            fwd["Host"] = f"{up_host}:{up_port}"
            fwd["Accept-Encoding"] = "identity"
            if req_body or method in ("POST", "PUT", "PATCH"):
                fwd["Content-Length"] = str(len(req_body))

            conn = http.client.HTTPConnection(up_host, up_port, timeout=900)
            try:
                conn.request(method, self.path, body=req_body or None, headers=fwd)
                resp = conn.getresponse()
            except Exception as e:  # noqa: BLE001 — 사유를 기록에 남기고 502 로 답한다
                entry.update(status=502, content_type=None, body_file=None, is_sse=False,
                             error=f"{type(e).__name__}: {e}",
                             duration_ms=int((time.monotonic() - mono0) * 1000))
                rec.commit(entry)
                msg = json.dumps({"detail": f"record_proxy: upstream 연결 실패 — {e}"},
                                 ensure_ascii=False).encode()
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(msg)))
                self.end_headers()
                self.wfile.write(msg)
                conn.close()
                return

            ttfb = int((time.monotonic() - mono0) * 1000)
            ct = resp.getheader("Content-Type", "") or ""
            disposition = resp.getheader("Content-Disposition")
            is_sse = "text/event-stream" in ct.lower()
            entry.update(status=resp.status, content_type=ct or None, is_sse=is_sse,
                         ttfb_ms=ttfb)
            if disposition:
                entry["content_disposition"] = mask_text(disposition)

            self.send_response(resp.status, resp.reason)
            for k, v in resp.getheaders():
                lk = k.lower()
                if lk in HOP_BY_HOP or lk == "content-length":
                    continue
                self.send_header(k, v)

            no_body = method == "HEAD" or resp.status in (204, 304) or 100 <= resp.status < 200
            clen = resp.getheader("Content-Length")
            stream = is_sse or clen is None
            if no_body:
                self.send_header("Content-Length", "0")
                self.end_headers()
                resp.read()
                body = b""
            elif not stream:
                body = resp.read()
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    entry["client_aborted"] = True
            else:
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                body, events, first_ms = self._relay_stream(resp, is_sse, mono0, entry)
                if is_sse:
                    lines = []
                    for ev in events:
                        if ev.get("data") is not None:
                            ev["data"] = mask_text(ev["data"])
                        lines.append(json.dumps(ev, ensure_ascii=False))
                    entry["sse_events"] = len(events)
                    entry["first_packet_ms"] = first_ms
                    entry["body_file"] = rec.write_file(
                        "sse", f"{index:03d}_{summary}.jsonl",
                        ("\n".join(lines) + ("\n" if lines else "")).encode("utf-8"))
            conn.close()

            entry["bytes"] = len(body)
            entry["duration_ms"] = int((time.monotonic() - mono0) * 1000)
            if not is_sse:
                if body:
                    masked = mask_body(body, ct, auth_path=auth_path)
                    entry["body_file"] = rec.write_file(
                        "responses", f"{index:03d}_{summary}{ext_for(ct, disposition)}", masked)
                else:
                    entry["body_file"] = None
            rec.commit(entry)

        def _relay_stream(self, resp, is_sse: bool, mono0: float, entry: dict):
            parser = SSEParser() if is_sse else None
            events: list[dict] = []
            buf = bytearray()
            first: float | None = None
            decoder = None
            if is_sse:
                import codecs
                decoder = codecs.getincrementaldecoder("utf-8")("replace")
            aborted = False
            while True:
                try:
                    chunk = resp.read1(65536)
                except Exception as e:  # noqa: BLE001
                    entry["upstream_error"] = f"{type(e).__name__}: {e}"
                    break
                if not chunk:
                    break
                now = time.monotonic()
                if first is None:
                    first = now
                buf.extend(chunk)
                if parser is not None:
                    t_ms = int((now - first) * 1000)
                    for ev in parser.feed(decoder.decode(chunk)):
                        events.append({"t_ms": t_ms, **ev})
                if not aborted:
                    try:
                        self._write_chunk(chunk)
                    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                        # 브라우저가 떠났다. 실제 사용과 같게 업스트림도 끊는다.
                        aborted = True
                        entry["client_aborted"] = True
                        break
            if parser is not None:
                t_ms = int((time.monotonic() - first) * 1000) if first else 0
                for ev in parser.feed(decoder.decode(b"", final=True)) + parser.flush():
                    events.append({"t_ms": t_ms, **ev})
            if not aborted:
                try:
                    self.wfile.write(b"0\r\n\r\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    entry["client_aborted"] = True
            first_ms = int((first - mono0) * 1000) if first else None
            return bytes(buf), events, first_ms

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = _proxy

    return Handler


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--listen", default="127.0.0.1:8001")
    ap.add_argument("--upstream", default="127.0.0.1:8000")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    host, port = args.listen.rsplit(":", 1)
    if host not in ("127.0.0.1", "::1", "localhost"):
        sys.exit("루프백 외 주소로는 열지 않는다 (--listen 127.0.0.1:PORT)")
    up_host, up_port = args.upstream.rsplit(":", 1)

    if args.out.exists() and any(args.out.iterdir()):
        sys.exit(f"{args.out} 가 비어 있지 않다 — 덮어쓰지 않는다")
    rec = Recorder(args.out, f"http://{args.upstream}")
    srv = Server((host, int(port)), make_handler(rec, up_host, int(up_port)))
    print(f"recording {args.listen} -> {args.upstream}  into {args.out}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        with rec.lock:
            rec._flush_locked()


if __name__ == "__main__":
    main()
