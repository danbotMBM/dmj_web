Generate new trivia questions and validate them.

## Steps

1. Generate the used answers index:
   ```
   cd /home/danbot/dev/dmj_web/backend && go run ./validate_trivia generate-index trivia_questions.json
   ```

2. Read these files for context:
   - `backend/trivia_questions_prompt.md` — style rules and format
   - `backend/used_answers.md` — answers used within the cooldown window (avoid all of these); the header notes the cutoff date and how many older answers have retired and are eligible for reuse with a fresh angle
   - The **last entry** in `backend/trivia_questions.json` — use it as a structural reference and to determine the next date

3. Generate $ARGUMENTS days of questions (default: 7 if not specified). For each day:
   - Default to broad top-level categories; only reach for a narrower subcategory when `used_answers.md` shows the broad category's easy answers are thin — don't invent a niche subcategory just to dodge the used-answers list
   - Write 9 questions following the format, difficulty, and style rules in the prompt
   - **Before finalizing each answer**, verify it does not appear in `used_answers.md` — "same answer" means the same concept/entity, not just the same string (e.g., "The Nile" and "Nile River" are the same answer)
   - Prefer reusing a retired (out-of-cooldown) classic answer with a genuinely different question angle over reaching for an obscure fact just to find fresh answer space
   - Dates must be sequential, continuing from the last date in the file

### When existing categories are running thin

If you find yourself repeatedly reaching for narrow, one-off subcategories (e.g. a category invented for a single day and never reused) just to dodge `used_answers.md`, that's a sign the *category list itself* needs to grow, not that the questions need to get more obscure. Before drilling further into niche subcategory territory:

- Check whether a genuinely new **broad** category (a whole new domain, not a sliver of an existing one) would open up fresh, mainstream answer space — think in terms of what an average American aged 20-40 would know a lot about, not what's technically unused.
- Good new broad categories are ones you could sustain for many days without immediately fragmenting into niche shards (contrast: "Art" fragmenting into Painting/Sculpture/Famous Artists/Modern Art/Impressionism after only a couple hundred questions is a sign it was too narrow a well to begin with, or needs a genuinely fresh area like Fashion & Design or Architecture instead of yet another Art sliver).
- Propose the new category to the user rather than silently adding obscure one-offs — call it out explicitly (e.g. "categories X/Y/Z are getting thin; consider adding [new category] as a broad category") so they can decide whether to add it to `trivia_questions_prompt.md`'s category list for future runs.

4. Append the new days to the `days` array in `backend/trivia_questions.json`.

5. Regenerate the index:
   ```
   cd /home/danbot/dev/dmj_web/backend && go run ./validate_trivia generate-index trivia_questions.json
   ```

6. Run the full validator:
   ```
   cd /home/danbot/dev/dmj_web/backend && go run ./validate_trivia trivia_questions.json
   ```

7. If semantic duplicate warnings are found:
   - Read `backend/used_answers.md` for the updated list of used answers
   - Replace the flagged question (the one with the later date) with a new question on a completely different topic
   - The replacement answer must NOT appear in `used_answers.md`
   - Re-run steps 5 and 6 until validation passes cleanly

## Rules

- Follow all formatting and style rules from `trivia_questions_prompt.md`
- Never reuse an answer concept that appears in `used_answers.md`
- Each day needs exactly 3 categories and 9 questions
- IDs follow the `YYYY-MM-DD_N` convention (0-indexed)
- Questions are ordered: category1 (100,200,300), category2 (100,200,300), category3 (100,200,300)
