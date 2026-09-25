<script setup lang="ts">
import { computed, ref } from "vue";

import type { LegendTranslator } from "@/components/legendDisplay";
import { createSearchService } from "@/search/searchService";
import type { SearchConfig, SearchSuggestion } from "@/search/searchTypes";
import { useMapSearch } from "@/search/useMapSearch";

const props = defineProps<{
  config: SearchConfig;
  translator: LegendTranslator;
  searchTimeoutMilliseconds?: number;
}>();

const emit = defineEmits<{ select: [suggestion: SearchSuggestion] }>();

const input = ref<HTMLInputElement | null>(null);

function focus(): void {
  input.value?.focus();
}

defineExpose({ focus });

const search = useMapSearch(createSearchService(props.config), { timeoutMilliseconds: props.searchTimeoutMilliseconds });
const { query, groupedResults, searching, hasQuery, noResults, error, clear } = search;
const resultCount = computed(() =>
  [...groupedResults.value.values()].reduce((suggestionCount, suggestions) => suggestionCount + suggestions.length, 0),
);

function groupTitle(type: string): string {
  const key = `map.search.type.${type}`;
  return props.translator.te(key) ? props.translator.t(key) : type;
}

const highlightExpression = computed(() => {
  const terms = query.value.split(/\s+/).filter((term) => term.length > 0);
  if (terms.length === 0) {
    return undefined;
  }
  const alternatives = terms
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((first, second) => second.length - first.length)
    .join("|");
  return new RegExp(`(${alternatives})`, "gi");
});

function highlightParts(description: string): { text: string; match: boolean }[] {
  const expression = highlightExpression.value;
  if (!expression) {
    return [{ text: description, match: false }];
  }
  return description.split(expression).map((text, index) => ({ text, match: index % 2 === 1 }));
}
</script>

<template>
  <div class="map-search-panel" data-id="map-search-panel">
    <div class="search-input-container">
      <input
        ref="input"
        v-model="query"
        type="text"
        class="search-input"
        :aria-label="translator.t('map.search.placeholder')"
        :placeholder="translator.t('map.search.placeholder')"
        data-id="map-search-input" />
      <button
        v-if="hasQuery"
        type="button"
        class="clear-button"
        :aria-label="translator.t('map.search.clear')"
        data-id="map-search-clear"
        @click="clear()">
        ×
      </button>
    </div>

    <div role="status" aria-live="polite" aria-atomic="true">
      <div v-if="searching" class="search-loading" data-id="map-search-loading">
        {{ translator.t("map.search.loading") }}
      </div>
      <div v-else-if="error" class="search-error" data-id="map-search-error">
        {{ translator.t("map.search.error") }}
      </div>
      <div v-else-if="noResults" class="search-no-results" data-id="map-search-no-results">
        <div class="title">{{ translator.t("map.search.noResults.title") }}</div>
        <div class="explainer">{{ translator.t("map.search.noResults.explainer") }}</div>
      </div>
      <span v-else-if="resultCount > 0" class="visually-hidden"> {{ translator.t("map.search.resultsAria") }}: {{ resultCount }} </span>
    </div>

    <div
      v-if="hasQuery"
      class="search-results"
      :aria-label="translator.t('map.search.resultsAria')"
      :aria-busy="searching"
      data-id="map-search-results"
      role="region">
      <div v-for="[type, suggestions] in groupedResults" :key="type" class="result-group">
        <div class="group-title">{{ groupTitle(type) }}</div>
        <ul class="result-list" :aria-label="groupTitle(type)">
          <li v-for="(suggestion, resultIndex) in suggestions" :key="suggestion.id">
            <button
              type="button"
              class="result-item"
              :aria-label="`${groupTitle(type)} result ${resultIndex + 1}: ${suggestion.description}`"
              :data-id="`map-search-result-${suggestion.id}`"
              @click="emit('select', suggestion)">
              <template v-for="(part, index) in highlightParts(suggestion.description)" :key="index">
                <b v-if="part.match">{{ part.text }}</b>
                <template v-else>{{ part.text }}</template>
              </template>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-search-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.search-input-container {
  display: flex;
  position: relative;
}

.search-input-container .search-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding-right: 2.5rem;
}

.search-input-container .clear-button {
  position: absolute;
  right: 0.25rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 2rem;
  height: 2rem;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 0;
  font: inherit;
  font-size: 1.25rem;
  line-height: 1;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--geo-accent, #0052a3);
}

.search-loading,
.search-error,
.search-no-results .explainer {
  font-style: italic;
}

.search-no-results .title {
  font-weight: bold;
}

.result-group .group-title {
  font-weight: normal;
  color: var(--geo-text, #14375b);
  background: var(--geo-search-heading-background, #f6f6f1);
  padding: 0.25rem var(--geo-spacing, 0.5rem);
}

.result-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.result-group .result-item {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  margin: 0;
  border-radius: 0;
  font: inherit;
  text-align: left;
  background: none;
  border: none;
  color: var(--geo-accent, #0052a3);
  padding: 0.25rem var(--geo-spacing, 0.5rem);
  cursor: pointer;
}

.result-group .result-item:hover {
  background: var(--geo-search-result-hover-background, #dddbc6);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
