FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Edwards.Api/Edwards.Api.csproj src/Edwards.Api/
RUN dotnet restore src/Edwards.Api/Edwards.Api.csproj
COPY src/ src/
RUN dotnet publish src/Edwards.Api/Edwards.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
# Documents and the email pickup folder live here (a volume in docker-compose); the app user must own it.
RUN mkdir -p /app/App_Data && chown $APP_UID /app/App_Data
USER $APP_UID
ENTRYPOINT ["dotnet", "Edwards.Api.dll"]
