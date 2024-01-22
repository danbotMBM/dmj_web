import random
import json

class player:
    stack = []
    hand = None
    fold = False
    name = "no name"

    def __init__(self, name):
        self.name = name

    def in_play(self):
        return True if self.hand else False

    #serializes player to a level that is visible to all players in the game
    def __json__(self):
        return {"in_play": self.in_play(), "fold": self.fold, "num_cards": len(self.stack), "name":self.name}
    
    def draw_card(self):
        self.hand = self.stack.pop(0)

    def play_cards(self, num_cards):
        cards = [self.stack.pop(0) for _ in range(num_cards)]
        return cards

class table:
    stack = []
    ante = 1
    players = []
    current_bet = 1
    player_turn = 0

    #serializes player to 
    # a level that is visible to all players in the game
    def __json__(self):
        return {"ante": self.ante, "current_bet": self.current_bet, "players":self.players, "player_turn":self.player_turn}
    
    def play_cards(self, cards):
        self.stack.append(cards)
        return {"played": cards}
    
    def next_player(self):
        self.player_turn += 1
        if self.player_turn >= len(self.players):
            self.player_turn = 0
        p = self.players[self.player_turn]
        if p.in_play() and not p.fold:
            return p
        
    
def public_encoder(o):
    return o.__json__()

cards = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']
deck = [i for i in cards for _ in range(4)]
random.shuffle(deck)

game_table = table()
game_table.players = [player(i) for i in range(1,4)]

def deal_cards(deck, game_table):
    index = 0
    while deck:
        p = game_table.players[index]
        game_table.players[index].stack.append(deck.pop())
        
def play_round(game_table):
    for p in game_table.players:
        p.draw_card()
    #send
    ante_player = game_table.player_turn
    last_betted = None
    
    play_more = True
    while play_more:
        p = game_table.players[game_table.player_turn]
        #wait for bet

        

        #round end cases
        

    

deal_cards(deck, game_table)
