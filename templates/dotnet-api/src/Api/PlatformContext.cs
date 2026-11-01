namespace Api;

/// <summary>Service identity the platform injects as environment variables (ecs-service module).</summary>
public static class PlatformContext
{
    public static readonly string Service = Env("SERVICE", "hello-dotnet-api");
    public static readonly string Team = Env("TEAM", "crew");
    public static readonly string Environment = Env("ENVIRONMENT", "local");
    public static readonly string Version = Env("VERSION", "dev");

    private static string Env(string name, string fallback) =>
        System.Environment.GetEnvironmentVariable(name) is { Length: > 0 } value ? value : fallback;
}
