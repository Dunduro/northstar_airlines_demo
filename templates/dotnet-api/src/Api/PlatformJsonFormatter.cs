using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging.Console;

namespace Api;

/// <summary>
/// Structured JSON logging with the platform's mandatory fields (architecture 3.1): one flat
/// JSON object per line with service, team, environment, version and correlation_id (taken
/// from the logging scope that <see cref="CorrelationIdMiddleware"/> opens per request).
/// </summary>
public sealed class PlatformJsonFormatter() : ConsoleFormatter(FormatterName)
{
    public const string FormatterName = "platform-json";

    // Log lines are not HTML: keep "+", quotes etc. readable instead of \u002B escapes.
    private static readonly JsonWriterOptions WriterOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public override void Write<TState>(in LogEntry<TState> logEntry, IExternalScopeProvider? scopeProvider, TextWriter textWriter)
    {
        var message = logEntry.Formatter?.Invoke(logEntry.State, logEntry.Exception);
        if (message is null && logEntry.Exception is null)
        {
            return;
        }

        var correlationId = "-";
        scopeProvider?.ForEachScope((scope, _) =>
        {
            if (scope is IEnumerable<KeyValuePair<string, object?>> pairs)
            {
                foreach (var pair in pairs)
                {
                    if (pair.Key == "correlation_id" && pair.Value is not null)
                    {
                        correlationId = pair.Value.ToString() ?? "-";
                    }
                }
            }
        }, (object?)null);

        using var buffer = new MemoryStream();
        using (var json = new Utf8JsonWriter(buffer, WriterOptions))
        {
            json.WriteStartObject();
            json.WriteString("timestamp", DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
            json.WriteString("level", Level(logEntry.LogLevel));
            json.WriteString("message", message);
            json.WriteString("service", PlatformContext.Service);
            json.WriteString("team", PlatformContext.Team);
            json.WriteString("environment", PlatformContext.Environment);
            json.WriteString("version", PlatformContext.Version);
            json.WriteString("correlation_id", correlationId);
            json.WriteString("logger", logEntry.Category);

            if (logEntry.State is IEnumerable<KeyValuePair<string, object?>> fields)
            {
                foreach (var field in fields)
                {
                    if (field.Key == "{OriginalFormat}")
                    {
                        continue;
                    }
                    switch (field.Value)
                    {
                        case int i: json.WriteNumber(field.Key, i); break;
                        case long l: json.WriteNumber(field.Key, l); break;
                        case double d: json.WriteNumber(field.Key, d); break;
                        case bool b: json.WriteBoolean(field.Key, b); break;
                        default: json.WriteString(field.Key, field.Value?.ToString()); break;
                    }
                }
            }

            if (logEntry.Exception is not null)
            {
                json.WriteString("error", logEntry.Exception.ToString());
            }
            json.WriteEndObject();
        }

        textWriter.WriteLine(Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length));
    }

    private static string Level(LogLevel level) => level switch
    {
        LogLevel.Trace => "trace",
        LogLevel.Debug => "debug",
        LogLevel.Information => "info",
        LogLevel.Warning => "warning",
        LogLevel.Error => "error",
        LogLevel.Critical => "critical",
        _ => "none",
    };
}
