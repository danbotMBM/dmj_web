Generate new trivia questions and validate them.

## Steps

1. Generate the used answers index:
   ```
   cd /home/danbot/dev/dmj_web/backend && go run ./validate_trivia generate-index trivia_questions.json
   ```

2. Read these files for context:
   - `backend/trivia_questions_prompt.md` — style rules and format
   - `backend/used_answers.md` — every answer already used (avoid all of these)
   - The **last entry** in `backend/trivia_questions.json` — use it as a structural reference and to determine the next date

3. Generate $ARGUMENTS days of questions (default: 7 if not specified). For each day:
   - Pick 3 categories (at least 1 specific subcategory per the prompt guide)
   - Write 9 questions following the format, difficulty, and style rules in the prompt
   - **Before finalizing each answer**, verify it does not appear in `used_answers.md` — "same answer" means the same concept/entity, not just the same string (e.g., "The Nile" and "Nile River" are the same answer)
   - Dates must be sequential, continuing from the last date in the file

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
