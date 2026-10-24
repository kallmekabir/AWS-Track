# CareLine Infrastructure Outputs

Every resource the infra runbook creates. Never put passwords or API key values here;
reference the Secrets Manager secret name or the API key ID instead.

| Name | Type | ID / ARN / URL | SSM key | Created by task | Notes |
| --- | --- | --- | --- | --- | --- |
| careline account | Account | 874092763686 | /careline/account-id | P0.1 | WSParticipantRole, us-east-1 |
