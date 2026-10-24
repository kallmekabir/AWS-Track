// CareLine site protection - HTTP Basic Auth on the CloudFront viewer-request.
// Attached to ALL behaviors (default S3 + /api/*).
//
// SECURITY: the real credential is injected ONLY into the deployed function
// (scripts/apply_basic_auth.sh / the infra agent at deploy time). This repo copy
// keeps a PLACEHOLDER. Never commit the real Authorization value.
function handler(event) {
  var request = event.request;
  var headers = request.headers;

  // base64("username:password"). Replaced at deploy time; placeholder here.
  var expected = "Basic REPLACE_WITH_BASE64_USER_PASS";

  if (!headers.authorization || headers.authorization.value !== expected) {
    return {
      statusCode: 401,
      statusDescription: "Unauthorized",
      headers: {
        "www-authenticate": { value: 'Basic realm="CareLine"' }
      }
    };
  }
  return request;
}
