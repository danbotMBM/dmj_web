Run the trivia validator and fix any semantically duplicate questions.

## Steps

1. Run the validator from the backend directory:
   ```
   cd /home/danbot/dev/dmj_web/backend && go run ./validate_trivia trivia_questions.json
   ```

2. Parse all `WARNING: near-duplicate questions` lines from the output. Each warning shows:
   - Two question IDs (e.g. `[2026-03-25_8]` and `[2026-03-13_5]`)
   - Their cosine similarity score
   - The text of each question

3. Generate the used answers index so you know what's already taken:
   ```
   cd /home/danbot/dev/dmj_web/backend && go run ./validate_trivia generate-index trivia_questions.json
   ```

4. For each flagged pair, the question with the **later date ID** is the one to replace. If both IDs are on the same date, replace the one with the higher index number.

5. Read `backend/trivia_questions.json` to find each flagged question's `category` and `points` value. Also read `backend/used_answers.md` to see all answers already in use.

6. Replace each flagged question with a brand new trivia question on a completely different topic. The replacement answer must **not** appear in `used_answers.md` (same concept, not just same string). Only change these fields:
   - `question` — new question text
   - `answer.valid` — array of valid answer strings
   - `display` — short canonical answer (e.g. `"The Nile"`, `"Shakespeare"`)

   Keep these fields unchanged: `id`, `category`, `points`

7. Regenerate the index after replacements:
   ```
   cd /home/danbot/dev/dmj_web/backend && go run ./validate_trivia generate-index trivia_questions.json
   ```

8. Re-run the validator to confirm:
   - Structural validation passes (zero errors)
   - Semantic warnings are reduced or eliminated

## Rules

- Replacement questions must be genuinely different topics — not just rephrased versions
- The new question must not semantically overlap with any other question in the file
- `display` should be a short, unambiguous answer label
- Structural errors (wrong ID format, wrong point values, missing categories, etc.) are blocking failures — fix them if they appear
- Semantic warnings are non-blocking but should be resolved
