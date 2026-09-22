# Lesson Plans directory

The maintained frontend is `lessons.js` plus the existing `workspace.js` editor and Files library. `src/teaching.ts` provides the directory, class lists, coverage and class-resource relationships. Document metadata uses the existing revision-protected save operation and resume state.

## Setup

Apply additive migration `sql/019_lesson_directory.sql` through the existing migration/setup process using the migration-owner connection. The existing production setup (`npm run db:setup:production`) also grants the restricted runtime role access to newly created tables; no production command was run for this change. Do not run migrations against production as part of tests.

Run `npm run build` to compile the backend and regenerate the ignored `public-build` directory, including the new `lessons.js` asset. No new dependencies are required.

Existing lessons stay in **Lesson Plans → Unassigned lessons** until the teacher selects a class workspace in the editor. Existing template documents remain available in **Lesson Plans → Legacy templates** and at the existing `/templates` route. Archived subjects and classes are available through **Archived subjects and classes**; linked content and rosters remain intact.

Subject/class assignments are explicit. Classes belong to Grades 8–12 and are reusable across subjects. Progress counts taught lessons within one subject/class workspace. Roster entries belong to the teacher's class, so a reusable class has the same private roster across subjects.

Duplicating into another workspace creates a new Draft, clears planned/taught dates and reflection, retains term/week and instructional content, and reuses ready resource links. Autosave recovery copies continue to preserve the current draft.

Videos are titled HTTPS links stored in the existing resources table with zero storage bytes and no object key. They are never fetched, embedded or scanned as uploaded files. Uploaded files continue through the existing quota, validation and malware-scanning pipeline. Resource categories apply in Files; Remove link in a lesson or class affects only that relationship. Delete library resource moves the underlying resource to the existing trash system and hides it from linked lessons/classes.

## Verification

- `npm run test:unit` includes `tests/lessons.test.mjs` and existing editor/autosave tests.
- `npm run test:integration` provisions isolated temporary PostgreSQL, Redis and S3-compatible containers, applies migrations, runs backend integration tests and removes the containers. The new behavioral and ownership cases live in `src/workspace.test.ts`.
- Browser layout verification requires working browser automation; DOM tests do not substitute for visual verification.

## Timetable photos

Timetables → class A–D now starts with a photo upload. JPG, PNG and WebP images up to 4 MB are read into text and a draft. The screen warns that blur, low resolution, cropping or covered sections can cause missing or incorrect information. Teachers compare the photo and transcription, select **Use extracted timetable**, correct missing subjects/times, then **Save timetable**. Reading a photo never writes a timetable. Existing data survives conversion errors and remains unchanged until saving.

Enable conversion by setting `OPENAI_API_KEY` in the server environment (or `.env` for local development) and restarting `npm run dev`. `TIMETABLE_VISION_MODEL` defaults to `gpt-4o` and can be set to another Responses-compatible image model with structured outputs. Keep the key server-side. Without a key, the page explicitly explains that conversion is unavailable and offers manual entry.

The server sends the selected image to OpenAI's Responses API with `store: false`; Chix does not persist the image or transcription. Provider data handling still applies. Authentication, active-class ownership checks, file signatures, request-size limits and a separate ten-reads-per-hour user limit protect the endpoint. The model is instructed not to infer obscured fields. Its result is schema-validated, but recognition remains fallible and requires teacher review. Readable source durations are preserved; new manual periods default to 45 minutes.

Implementation references: [image inputs](https://developers.openai.com/api/docs/guides/images-vision) and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
