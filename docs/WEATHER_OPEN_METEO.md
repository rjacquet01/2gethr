# Calendar weather (Open-Meteo)

The calendar's forecast comes from Open-Meteo through our own signed-in proxy (`/api/weather`). It sends only coordinates rounded to 2 decimals (about 1 km), and responses are cached for 30 minutes.

## Free vs. commercial

- **No key set (default):** uses Open-Meteo's free endpoint (`api.open-meteo.com`). Open-Meteo's free tier is for non-commercial use.
- **Key set:** uses the commercial endpoint (`customer-api.open-meteo.com`) with your key.

## After you subscribe to the Open-Meteo Standard plan

1. Copy your API key from your Open-Meteo account.
2. In Vercel > Project > Settings > Environment Variables, add `OPEN_METEO_API_KEY` with that key for **Production**, and **Preview** too if you want previews to use it.
3. Redeploy.

The key never goes in code, git or chat. The server never logs it or sends it to the browser, and it never appears in error messages.

The calendar shows "Weather data by Open-Meteo.com" under the calendar whenever weather is shown, as Open-Meteo's terms ask.
