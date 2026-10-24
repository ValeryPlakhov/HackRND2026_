FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY src ./src
RUN mkdir build && javac --release 21 -encoding UTF-8 -d build src/*.java
FROM eclipse-temurin:21-jdk
WORKDIR /app
COPY --from=build /app/build ./build
COPY web ./web
COPY examples ./examples
ENV BIND_HOST=0.0.0.0 PORT=8080 BLUEPRINTS_RUNNER=local
EXPOSE 8080
USER 65534:65534
CMD ["java", "-Xmx512m", "-cp", "build", "BlueprintServer"]
