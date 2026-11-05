using System.Text.Json;
using System.Text.Json.Serialization;
using TournamentServices.Api.Extensions;
using TournamentServices.Api.Handlers;
using TournamentServices.Api.Routes;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddTournamentServices(builder.Configuration);
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddProblemDetails();

// camelCase por defecto; enums como string: RoundRobin -> "ROUND_ROBIN", Home -> "HOME"
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(
        new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseUpper)));

var app = builder.Build();

app.UseExceptionHandler();

// UseDefaultFiles tiene que ir antes que UseStaticFiles para que "/" encuentre index.html.
// Con no-cache el navegador revalida cada archivo y los cambios se ven con solo recargar.
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache"
});

app.MapGet("/health", () => "Services running");
app.MapTeamRoutes();
app.MapTournamentRoutes();
app.MapGroupRoutes();
app.MapMatchRoutes();
app.MapBracketRoutes();

app.Run();

// Necesario para pruebas de integración con WebApplicationFactory<Program>
public partial class Program { }