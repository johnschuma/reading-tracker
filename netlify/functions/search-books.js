exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured" }) };
  }

  let query;
  try {
    ({ query } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  if (!query || !query.trim()) {
    return { statusCode: 400, body: JSON.stringify([]) };
  }

  const prompt =
    "You are a book database. Return a JSON array of up to 5 real books matching: " +
    JSON.stringify(query) +
    ". Each object: title (string), author_name (array of strings), first_publish_year (string), open_library_cover_id (integer or null). ONLY raw JSON array.";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    return { statusCode: 502, body: JSON.stringify({ error: "Upstream API error" }) };
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "[]";

  let books;
  try {
    books = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    books = [];
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(books),
  };
};
