# API Endpoints

Base URL: `/api/v1`

## Gates

- `GET /gates` - list gate and bollard states
- `POST /gates/:gateId/command` - send `open` or `lock` command
- `GET /gates/emergency` - fetch current emergency mode
- `POST /gates/emergency` - set `lockdown`, `fire`, or `normal`

## Access Control

- `GET /access/rules` - access rules catalogue
- `POST /access/evaluate` - evaluate `{ gateId, credentialGroup }`

## Scheduler

- `GET /scheduler/dashboard` - aggregate admin metrics
- `GET /scheduler/rules` - list gate schedules
- `POST /scheduler/rules` - create or update a schedule record

## AI

- `GET /ai/insights` - recommendations derived from live state
- `GET /ai/weather` - current weather layer summary

## Facility Hire

- `GET /hire` - approved and pending hire access windows
- `POST /hire` - create a hire booking request

## Auth headers

Development mode reads operator context from headers:

- `x-operator-id`
- `x-operator-name`
- `x-portal-role`
