# syntax=docker/dockerfile:1
# Multi-stage: the SDK image compiles on the build machine's own architecture and
# cross-targets the image architecture; the runtime is Ubuntu "chiseled" ASP.NET (no shell,
# no package manager, non-root "app" user by default).

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0 AS build
ARG TARGETARCH
WORKDIR /src
COPY src/Api/Api.csproj src/Api/
RUN dotnet restore src/Api/Api.csproj -a "$TARGETARCH"
COPY src/Api/ src/Api/
RUN dotnet publish src/Api/Api.csproj -c Release -a "$TARGETARCH" --no-restore -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0-noble-chiseled AS runtime
WORKDIR /app
ENV PORT=8080 \
    DOTNET_EnableDiagnostics=0
COPY --from=build /app .
USER app
EXPOSE 8080
# No HEALTHCHECK: there is no shell or curl in the image; the ALB probes GET /health.
ENTRYPOINT ["dotnet", "Api.dll"]
