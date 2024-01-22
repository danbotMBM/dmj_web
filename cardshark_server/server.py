from flask import Flask
import random

app = Flask(__name__)

@app.route("/")
def random_number():
    return str(random.randint(0,15))