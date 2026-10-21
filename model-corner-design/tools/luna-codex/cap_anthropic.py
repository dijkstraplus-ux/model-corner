# 假 Anthropic 端点：把 Claude Code 发出的每个 POST 存下来，一律回 400
import http.server, json, itertools
n = itertools.count()
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        b = self.rfile.read(int(self.headers.get('content-length', 0)))
        open('/tmp/claude-cap/%02d%s.json' % (next(n), self.path.split('?')[0].replace('/', '_')), 'wb').write(b)
        self.send_response(400); self.send_header('content-type', 'application/json'); self.end_headers()
        self.wfile.write(b'{"type":"error","error":{"type":"invalid_request_error","message":"capture"}}')
    def do_GET(self):
        self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', 47998), H).serve_forever()
