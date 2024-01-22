from flask import Flask
import random
import json

app = Flask(__name__)

@app.route("/")
def random_number():
    return json.dumps({"value":str(random.randint(0,15))})