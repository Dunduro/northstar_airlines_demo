using Api;
using Microsoft.Extensions.Logging.Console;

var builder = WebApplication.CreateBuilder(args);

// Platform conventions (architecture 3.1): flat JSON logs with the mandatory fields.
builder.Logging.ClearProviders();
builder.Logging.AddConsole(options => options.FormatterName = PlatformJsonFormatter.FormatterName);
builder.Logging.AddConsoleFormatter<PlatformJsonFormatter, ConsoleFormatterOptions>(options => options.IncludeScopes = true);

// The ecs-service module passes PORT; ASP.NET's own default in containers is 8080 too.
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://+:{port}");

// ECS stops tasks with SIGTERM and waits 30 s: drain in-flight requests within that.
builder.Services.Configure<HostOptions>(options => options.ShutdownTimeout = TimeSpan.FromSeconds(25));

var app = builder.Build();

app.UseMiddleware<CorrelationIdMiddleware>();

// Liveness for the ALB health check: no dependency calls.
app.MapGet("/health", () => Results.Ok(new { status = "ok", service = PlatformContext.Service, version = PlatformContext.Version }));

app.MapGet("/", (HttpContext context, ILogger<Program> logger) =>
{
    logger.LogInformation("said hello {event}", "hello");
    return Results.Ok(new { message = $"Hello from {PlatformContext.Service}", correlation_id = context.Items["correlation_id"] });
});

app.Run();

/// <summary>Exposed for WebApplicationFactory in the tests.</summary>
public partial class Program;
