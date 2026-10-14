// Creates an error that carries the HTTP status the route should respond with.
function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

module.exports = { httpError };