# Trivia Questions Generation Guide

## Overview

Generate daily trivia grids in the format of `trivia_questions.json`. Each day has **3 categories**, each with **3 questions** of increasing difficulty (100, 200, 300 points).

## JSON Structure

```json
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "categories": ["Category1", "Category2", "Category3"],
      "questions": [
        {
          "id": "YYYY-MM-DD_0",
          "category": "Category1",
          "points": 100,
          "question": "Question text goes here.",
          "answer": { "valid": ["primary answer", "alternate answer"] },
          "display": "Official Display Answer"
        }
      ]
    }
  ]
}
```

### ID Convention
- IDs are `YYYY-MM-DD_N` where N is the 0-indexed position in the questions array.
- Questions are ordered: all 100s first, then 200s, then 300s — grouped by category in the order categories are listed.
- So for categories [A, B, C]: A_100=index 0, A_200=index 1, A_300=index 2, B_100=index 3, B_200=index 4, B_300=index 5, C_100=index 6, C_200=index 7, C_300=index 8.

## Difficulty Guidelines

| Points | Target Success Rate | Description |
|--------|-------------------|-------------|
| 100 | ~95% | Very accessible. Even someone unfamiliar with the category should get it. Classic, well-known facts. |
| 200 | ~70% | Moderate. Familiar to anyone with general interest in the category, tougher for someone with no knowledge of it. |
| 300 | ~50% | Challenging. Still general knowledge, but only recognizable if you have some familiarity with the category. |

## Question Writing Rules

1. **Never include the answer in the question.** Rephrase to avoid giving it away.
2. **Provide multiple valid answers** when the answer could reasonably be phrased multiple ways (e.g., `["einstein", "albert einstein"]`, `["nile", "nile river"]`).
3. **The `display` field** is the canonical, nicely formatted answer shown to the user after answering (e.g., `"The Great Pyramid of Giza"`).
4. **Valid answers** should be lowercase and cover common variations, abbreviations, and alternate phrasings.
5. Questions should be phrased in the **Jeopardy style**: describe the answer, don't ask a direct question — though direct questions are fine too.

## Audience & Category Guidelines

- Target audience: **average American aged 20–40**.
- Stick to **general knowledge** — pop culture, history, science, geography, sports, music, movies, TV, food, literature, etc.
- Feel free to invent new categories, but keep them within the realm of things a typical person in that age range would have encountered.
- Avoid hyper-niche, academic, or overly regional topics.

## Example Categories Used

Science, History, Pop Culture, Geography, Literature, Sports, Music, Food & Drink, Technology, Movies, U.S. Presidents, Animals, Television, World Geography, Nature, Video Games, Space, Art, Language, Math & Numbers, U.S. Geography, Mythology

## Example Entries

Below are three examples showing all point levels and how to handle varying numbers of valid answers.

### 100 points — single valid answer
```json
{
  "id": "2026-02-22_0",
  "category": "Science",
  "points": 100,
  "question": "This planet is the closest to the Sun.",
  "answer": { "valid": ["mercury"] },
  "display": "Mercury"
}
```

### 200 points — a few valid phrasings
```json
{
  "id": "2026-02-22_3",
  "category": "History",
  "points": 200,
  "question": "This ancient wonder of the world is the only one still standing today.",
  "answer": { "valid": ["great pyramid", "great pyramid of giza", "pyramid of giza", "pyramids"] },
  "display": "The Great Pyramid of Giza"
}
```

### 300 points — name with many common forms
```json
{
  "id": "2026-02-22_6",
  "category": "Literature",
  "points": 300,
  "question": "This Colombian author wrote 'One Hundred Years of Solitude'.",
  "answer": { "valid": ["gabriel garcia marquez", "gabriel marques" ,"garcia marquez", "marquez"] },
  "display": "Gabriel García Márquez"
}
```

### When to add more valid answers

| Situation | Example |
|-----------|---------|
| Full name vs. last name only | `["muhammad ali", "ali"]` |
| With/without article | `["nile", "nile river"]` |
| Common abbreviation | `["http", "hypertext transfer protocol"]` |
| Spelling variants | `["lasagna", "lasagne"]`, `["bosphorus", "bosporus"]` |
| Alternate titles or nicknames | `["great wall", "great wall of china"]` |
| Possessive vs. non-possessive | `["dads army", "dad's army"]` |

## Notes

- The backend uses **lexicographical distance** to allow for minor typos, so valid answers don't need to account for every possible misspelling.
- Each day should have exactly **9 questions** (3 categories × 3 difficulty levels).
- Dates should be sequential and not reuse dates already in the file.
