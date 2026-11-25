# Prognozomierz — wersja web

Statyczna aplikacja pogodowa: interaktywny meteogram 5 modeli (konsensus, porównanie),
ostrzeżenia IMGW-PIB, obserwacje synoptyczne i prognoza 7-dniowa.

- Strona: publikowana przez GitHub Pages z katalogu `site/`.
- Źródła danych: Open-Meteo (prognoza i geokodowanie) oraz IMGW-PIB (ostrzeżenia, synop).
- Bez backendu i bez kluczy API; ustawienia w `localStorage`.
- Polityka prywatności: `site/privacy.html`.

## Publikacja

Push do `main` uruchamia workflow `.github/workflows/pages.yml`, który publikuje
zawartość `site/` na GitHub Pages. W ustawieniach repozytorium Pages musi mieć
źródło „GitHub Actions” (workflow próbuje włączyć je sam).

## Wsparcie

[Postaw kawę autorowi](https://buycoffee.to/bienek).
