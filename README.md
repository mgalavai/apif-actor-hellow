# Hello API Wrapper

A tiny Apify Actor that turns JSON input into JSON output.

## Input
```json
{
  "name": "Mir",
  "repeat": 3,
  "echoInput": false
}
```

## Output

This Actor stores results in the default dataset (one row per message), e.g.

```json
{ "message": "Hello, Mir! #1", "ts": "2026-01-12T12:00:00.000Z" }
```

## Typical usage

- As a “hello world” template for API-wrapper Actors
- As a skeleton for adding real HTTP calls, auth, retries, and normalization
