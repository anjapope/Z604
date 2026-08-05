# Z604

A classroom demo for a library services portal with:

- searchable card catalog
- events calendar
- account mock pages
- chatbot UI wired to a secure backend `/api/chat` route

## Run locally (secure chat enabled)

1. Install dependencies:
	- `npm install`
2. Configure environment variables:
	- `cp .env.example .env`
	- set `OPENAI_API_KEY` in `.env`
3. Start the app:
	- `npm start`
4. Open:
	- `http://localhost:4000`

## Notes

- The API key stays server-side in `.env` and is never exposed to browser JavaScript.
- If the backend is unavailable or key is missing, chat falls back to canned demo replies.
