import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n=int(self.headers.get('content-length',0)); b=self.rfile.read(n)
        open('/tmp/luna-codex-cap/req_%s.bin'%self.path.replace('/','_'),'wb').write(b)
        open('/tmp/luna-codex-cap/hdr.txt','w').write(str(self.headers))
        self.send_response(400); self.send_header('content-type','application/json'); self.end_headers(); self.wfile.write(b'{"error":{"message":"capture"}}')
    def log_message(self,*a): pass
http.server.HTTPServer(('127.0.0.1',47999),H).serve_forever()
