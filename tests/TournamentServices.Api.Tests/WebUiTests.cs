using System.Net;

namespace TournamentServices.Api.Tests;

public class WebUiTests : TournamentApiTests
{
    [Fact]
    public async Task Raiz_SirveLaInterfaz()
    {
        var response = await Client.GetAsync("/");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("Torneo de doble eliminación", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("/js/app.js", "text/javascript")]
    [InlineData("/css/styles.css", "text/css")]
    public async Task ArchivosEstaticos_SeSirvenConSuTipo(string path, string mediaType)
    {
        var response = await Client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(mediaType, response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Health_SigueRespondiendo()
    {
        var response = await Client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Services running", await response.Content.ReadAsStringAsync());
    }
}
