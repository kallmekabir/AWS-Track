# CareLine Infra Handoff

How to operate and extend the CareLine AWS hosting. No secret values appear in this file.

## What is live

| Thing | Value |
| --- | --- |
| Dashboard + API URL | https://d1baurlz014iv6.cloudfront.net (behind HTTP Basic Auth) |
| Health check | https://d1baurlz014iv6.cloudfront.net/api/health |
| Login | HTTP Basic Auth, username `careline`. Password held by Himanshu; it lives only in the deployed CloudFront Functions `careline-auth` / `careline-auth-strip`, never in git. |
| API backend | EC2 i-025ac542a085a7bf0 running backend/ FastAPI (uvicorn app.main:app) on :8000, reached only through CloudFront |
| Data | DynamoDB careline-residents, careline-checkins (on-demand) |
| Bedrock | guardrail careline-guardrail (bathrr9vaolx v2); invocation logging to s3://careline-artifacts-874092763686/bedrock-logs/ |
| Connect (Kabir) | instance 4ade3c42-cea3-4150-a6a5-b6443923e464; adopted, not infra-managed |
| Observability | CloudWatch dashboard "CareLine"; budget careline-hackathon ($25, 50/80% alerts) |

All resource IDs/ARNs and SSM keys: `docs/infra-outputs.md`. Config is in SSM `/careline/*`.

## Architecture (no IAM roles)

The workshop role cannot create IAM roles, so there are no Lambdas/Step Functions/API
Gateway/KB. The backend runs on a plain EC2 instance with **no instance profile**;
AWS access uses a temporary credentials file at `/etc/careline/credentials` pushed from
a laptop. CloudFront fronts both the S3 dashboard (default behavior) and the EC2 API
(`/api/*`, with a function that strips `/api` since the app has no prefix). Basic auth is
enforced by CloudFront Functions on every behavior.

## Credentials on the instance (IMPORTANT)

The instance has NO role. It uses temporary WSParticipant session credentials written to
`/etc/careline/credentials` (mode 0600). **These expire (roughly a 12-hour workshop
session; exact expiry not queryable from an assumed-role session).** When Bedrock/Connect
calls on the instance start returning `ExpiredToken`:

```bash
# export a fresh WSParticipant session into your shell, then:
scripts/push_creds.sh        # pushes creds to the instance, restarts careline-core
```

Never commit these creds or write them anywhere but `/etc/careline/credentials`.

## Deploying code

```bash
scripts/deploy_core.sh   # backend: git pull + pip install + restart on the instance
scripts/deploy_web.sh    # dashboard: npm build + s3 sync + CloudFront invalidation
                         # (build with VITE_API_URL=https://d1baurlz014iv6.cloudfront.net/api)
```

Switching config without a redeploy: edit `/etc/careline/backend.env` on the instance
(via EC2 Instance Connect) and `sudo systemctl restart careline-core`. Keys include
`CONNECT_DRY_RUN`, `ALLOWED_ORIGINS`, table names, Bedrock model/guardrail IDs.

## No-hook application contract (Oct 24)

The application now collects results with `app/call_results.py` after Connect
disconnects, using persisted intent and a1–a5 contact attributes. Deploy one uvicorn
worker so its five-second lifespan checker and poll-triggered checks share a lock.
The timeout backstop is 300 seconds from call_started_at. Install the runtime from
backend/requirements.txt; no Mangum adapter or execution function is used.

The selected Lex bot is CareCallCheckIn (en_US, published live alias), with five
FreeFormInput slots and a repeated safety prompt to fill A1. Emergency phrases in
slots escalate after disconnect; early hang-up can bypass attribute copying. Follow
[connect/SETUP.md](../../connect/SETUP.md) for console/phone acceptance before
switching to the new flow. These code changes were tested locally; this document
update does not verify that the current collector is deployed.

## Pending / TODO for teammates

- **CONNECT_CONTACT_FLOW_ID is Kabir's TEST flow** (`40ac3787...`, "CareCall test call").
  Switch it to Kabir's real check-in flow when published, then flip `CONNECT_DRY_RUN=0`
  (only after Himanshu confirms). Update both `/etc/careline/backend.env` and SSM
  `/careline/connect/flow-id`.
- Resident data: tables are empty. Seed via the app's POST /residents or a seed script.

## Reading logs

```bash
# on the instance (EC2 Instance Connect):
sudo journalctl -u careline-core -f
# Bedrock invocation logs: s3://careline-artifacts-874092763686/bedrock-logs/
# CloudWatch dashboard: console -> CloudWatch -> Dashboards -> CareLine
```

## If the instance stops

Workshop accounts may reap idle instances. If i-025ac542a085a7bf0 is stopped/terminated:
- Stopped: `aws ec2 start-instances --instance-ids i-025ac542a085a7bf0`, wait, then
  `scripts/push_creds.sh` (public DNS/IP may change; re-read it and update the CloudFront
  origin in `infra/cfn/careline-web.yaml` + redeploy CareLineWeb if the DNS changed).
- Terminated: redeploy `CareLineCompute` (see infra/cfn), then push creds and update the
  web stack's `Ec2PublicDns` parameter.

## Smoke test

```bash
BASIC_AUTH='careline:<password>' scripts/smoke.sh   # read-only, PASS/FAIL, non-zero on fail
```

## Teardown (gate G1 - do not run without approval)

`scripts/teardown.sh` deletes all infra-owned resources (stacks, buckets, guardrail,
dashboard, budget, SSM) and **leaves Kabir's Connect instance/flow/number intact**.
