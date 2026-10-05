"""开发用静态服务器：禁用缓存，改完代码刷新即生效。

用法：python tools/serve.py [端口]（默认 8917），然后打开 http://localhost:8917/
玩家不需要它——直接双击 index.html 就能玩。
"""
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8917
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCache).serve_forever()
