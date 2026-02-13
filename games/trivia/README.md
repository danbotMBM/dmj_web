# Daily trivia game inspired by jeopardy

## GOAL
Make a simple 3x3 grid of trivia in the style of jeopardy. The grid will have the category of the trivia at the top with each column of trivia being of that category. Each category of trivia will have 3 questions beginning at the top with the easiest question at the top and increasing in difficulty as you go down. The point values will be 100, 200, and 300 as the difficulty increases.

The user will not login but rather simple browser state will hold the info on what questions they have already attempted and which ones they have gotten correct. There should be a color for a grid element not yet attempted, one incorrect, and one gotten correct. The user will have 3 strikes. A strike is added whenever a user gets an answer wrong. Once the user is out of questions to attempt or strikes the game should stop and display the user's score and a emoji representation of the resulting grid. So if the user got category 1: 100 correct and all category 2 questions wrong before runnign out of strikes their score would be 100 and the grid would be something like . This grid should be able to be copied with one click to be easily shared.

🟩🟥🟦
🟦🟥🟦
🟦🟥🟦
score: 100

The back end will serve the grid of questions for a given day, then the user will select a question of a category and point value from the grid. This will then show the user a trivia question to which they will import an answer in words. This answer will be submitted to the back end and the backend will return correct or not along with an "official" version of the answer. The backend will have multiple valid answers for each question to account for slight variations of valid answers. Additionally, the backend will use a lexigraphical distance to allow for a small amount of typo in the answer.

This webpage should be primarily built for mobile but should also look good on desktop.

So the backend should have a get endpoint for a grid of questions with categories and question ids. And another endpoint pulling the question from its id (attempting it). And then another for attemping to submit an answer for a question.

