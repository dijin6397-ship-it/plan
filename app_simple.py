from flask import Flask

app = Flask(__name__)

@app.route("/")
def hello():
    return {"message": "Hello from Vercel!", "status": "ok"}

@app.route("/health")
def health():
    return {"ok": True}

# Vercel requires the app to be named 'app'
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
