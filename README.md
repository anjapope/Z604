# Z604

A Stapleton Public Library portal demo with:

- searchable card catalog
- events calendar
- account mock pages
- Pericles-guided chatbot UI wired to a secure backend `/api/chat` route

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
- If the backend is unavailable or the key is missing, chat falls back to guided Stapleton Public Library replies.
