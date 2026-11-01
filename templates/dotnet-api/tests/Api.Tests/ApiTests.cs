using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Api.Tests;

public sealed class ApiTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Health_answers_200_for_the_alb()
    {
        var response = await factory.CreateClient().GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        Assert.Equal("ok", body!["status"]);
    }

    [Fact]
    public async Task A_valid_correlation_id_is_reused_and_echoed()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/");
        request.Headers.Add("x-correlation-id", "abc-123");
        var response = await factory.CreateClient().SendAsync(request);
        Assert.Equal("abc-123", response.Headers.GetValues("x-correlation-id").Single());
    }

    [Fact]
    public async Task A_malformed_correlation_id_is_replaced()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/");
        request.Headers.TryAddWithoutValidation("x-correlation-id", "bad id");
        var response = await factory.CreateClient().SendAsync(request);
        Assert.True(Guid.TryParse(response.Headers.GetValues("x-correlation-id").Single(), out _));
    }
}
