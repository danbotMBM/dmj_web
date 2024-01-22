from flask import Flask
import random
import json
import cardshark

app = Flask(__name__)

@app.route("/random_number")
def random_number():
    return json.dumps({"value":str(random.randint(0,15))})

@app.route("/game", methods = ['GET', 'POST'])
def send_state():
    return json.dumps(cardshark.game_table, default=cardshark.public_encoder, indent=2)