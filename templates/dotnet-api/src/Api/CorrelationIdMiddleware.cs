using System.Diagnostics;
using System.Text.RegularExpressions;

namespace Api;

/// <summary>Accepts or mints x-correlation-id, echoes it, and puts it on every log line of the request.</summary>
public sealed partial class CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> logger)
{
    public const string Header = "x-correlation-id";

    [GeneratedRegex("^[A-Za-z0-9._:-]{1,128}$")]
    private static partial Regex Valid();

    public async Task InvokeAsync(HttpContext context)
    {
        var inbound = context.Request.Headers[Header].ToString();
        var correlationId = Valid().IsMatch(inbound) ? inbound : Guid.NewGuid().ToString();
        context.Items["correlation_id"] = correlationId;
        context.Response.Headers[Header] = correlationId;

        using var scope = logger.BeginScope(new Dictionary<string, object?> { ["correlation_id"] = correlationId });
        var started = Stopwatch.GetTimestamp();
        await next(context);
        logger.LogInformation(
            "request completed {method} {path} {status} {duration_ms}",
            context.Request.Method,
            context.Request.Path.Value,
            context.Response.StatusCode,
            Math.Round(Stopwatch.GetElapsedTime(started).TotalMilliseconds, 1));
    }
}
