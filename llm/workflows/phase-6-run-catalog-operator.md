# Phase 6 Operator Workflow (Run Catalog)

## Goal
Find, replay, and clone runs across hosts with durable host linkage.

## Preconditions
- federation API is running
- hosts are enrolled
- control-plane auth headers are supplied when enabled

## 1. Search Catalog
```bash
curl -sS "http://127.0.0.1:8787/api/jobs?hostId=h_alpha01&state=completed&repo=alpha-app&from=<ISO_TIMESTAMP>&to=<ISO_TIMESTAMP>&limit=25&offset=0"
```

## 2. Inspect Run
```bash
curl -sS "http://127.0.0.1:8787/api/jobs/j_example001"
```

## 3. Rerun Existing Job
```bash
curl -sS -X POST "http://127.0.0.1:8787/api/jobs/j_example001/rerun" \
  -H "content-type: application/json" \
  -d '{"startNow": true}'
```

## 4. Clone Run Into New Job
```bash
curl -sS -X POST "http://127.0.0.1:8787/api/jobs/j_example001/clone" \
  -H "content-type: application/json" \
  -d '{"jobId":"j_clone001","startNow":true}'
```

## Expected Outcomes
- catalog results include host-aware metadata and replay source
- rerun executes on the original routed host
- clone defaults to original host unless a different host is explicitly requested
