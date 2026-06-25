// Home — Fresha-style search/map screen.
//
// Layout (full-bleed):
//   ┌─────────────────────────────┐
//   │ <SearchPill> (mt-safe + mx-4)│  overlay on map
//   │                             │
//   │       react-native-maps     │  full screen
//   │       custom MarkerPills    │
//   │                             │
//   │ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ <— handle  │
//   │ <FilterChips>               │  sticky in sheet
//   │ X venues nearby             │
//   │ <FlashList of VenueCard>    │
//   └─────────────────────────────┘
//
// One filter object → both markers and cards; the marker↔card sync is
// kept inside this file because both sides need the same refs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
// Map import goes through MapShim so the web bundle resolves to a
// placeholder; native uses react-native-maps directly.
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "@/features/places/MapShim";
import BottomSheet, { BottomSheetFlashList } from "@gorhom/bottom-sheet";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";

import { SearchPill } from "@/components/SearchPill";
import { FilterChips } from "@/features/places/FilterChips";
import { MarkerPill } from "@/features/places/MarkerPill";
import { VenueCard } from "@/features/places/VenueCard";
import { FilterDrawer, type FilterDrawerHandle, type FilterValue } from "@/components/FilterDrawer";
import { CATEGORIES } from "@/features/places/categories";
import { filterVenues } from "@/features/places/filter";
import { useSearch, setSearch } from "@/features/search/store";

import { SAMPLE_BUSINESSES, COLABA_CENTER } from "@web/places/sample-businesses";
import type { Business } from "@web/places/types";

const INITIAL_REGION: Region = {
  latitude: COLABA_CENTER.lat,
  longitude: COLABA_CENTER.lng,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

export default function HomeScreen() {
  return (
    <BottomSheetModalProvider>
      <HomeInner />
    </BottomSheetModalProvider>
  );
}

function HomeInner() {
  const insets = useSafeAreaInsets();
  const search = useSearch();

  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterValue, setFilterValue] = useState<FilterValue>({
    vertical: null,
    minRating: 0,
    maxKm: 10,
  });

  const mapRef = useRef<MapView>(null);
  // BottomSheetFlashList's forwardRef erases the inner FlashList ref's
  // shape; we only need scrollToIndex, so a minimal interface keeps the
  // call site type-safe without dragging the full FlashList type in.
  const listRef = useRef<{ scrollToIndex(args: { index: number; animated?: boolean }): void } | null>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const drawerRef = useRef<FilterDrawerHandle>(null);

  const snapPoints = useMemo(() => ["12%", "45%", "90%"], []);

  // ─── location bootstrap ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        if (!cancelled) setSearch({ locationLabel: "Set location" });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (cancelled) return;
      const userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const places = await Location.reverseGeocodeAsync({
        latitude: userLoc.lat,
        longitude: userLoc.lng,
      });
      const first = places[0];
      const label = first?.city || first?.subregion || first?.region || "Current location";
      if (!cancelled) {
        setSearch({ userLoc, locationLabel: label });
        mapRef.current?.animateToRegion(
          {
            latitude: userLoc.lat,
            longitude: userLoc.lng,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          },
          400,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── unified filter ──────────────────────────────────────────────
  // Chip-row vertical + drawer-form vertical resolve to the same field;
  // chip wins because it's the foreground gesture. The query from
  // /search lands here too.
  const cat = CATEGORIES.find((c) => c.key === activeCategory);
  const effectiveVertical = cat?.vertical ?? filterValue.vertical;

  const filtered: Business[] = useMemo(
    () =>
      filterVenues(SAMPLE_BUSINESSES, {
        vertical: effectiveVertical,
        query: search.query,
        minRating: filterValue.minRating || undefined,
      }),
    [effectiveVertical, search.query, filterValue.minRating],
  );

  // ─── marker / card sync ──────────────────────────────────────────
  const indexOfSelected = useMemo(() => {
    if (!selectedId) return -1;
    return filtered.findIndex((b) => b.place_id === selectedId);
  }, [filtered, selectedId]);

  const onMarkerPress = useCallback(
    (id: string) => {
      setSelectedId(id);
      sheetRef.current?.snapToIndex(1);
      // Scroll runs after the sheet expands; FlashList ignores out-of-range
      // scrollToIndex calls so a chip-driven filter that removes the
      // selected venue is safely a no-op.
      requestAnimationFrame(() => {
        const idx = filtered.findIndex((b) => b.place_id === id);
        if (idx >= 0) {
          listRef.current?.scrollToIndex({ index: idx, animated: true });
        }
      });
    },
    [filtered],
  );

  // ─── filter drawer ───────────────────────────────────────────────
  const onApplyFilters = useCallback((next: FilterValue) => {
    setFilterValue(next);
    // Drawer-driven vertical wins if user picked one explicitly.
    if (next.vertical) {
      const match = CATEGORIES.find((c) => c.vertical === next.vertical);
      if (match) setActiveCategory(match.key);
    } else {
      setActiveCategory("all");
    }
  }, []);

  // ─── render ──────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-paper-100">
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={PROVIDER_GOOGLE}
        initialRegion={INITIAL_REGION}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {filtered.map((b) => (
          <Marker
            key={b.place_id}
            coordinate={{ latitude: b.lat, longitude: b.lng }}
            onPress={() => onMarkerPress(b.place_id)}
            tracksViewChanges={false}
          >
            <MarkerPill business={b} selected={selectedId === b.place_id} />
          </Marker>
        ))}
      </MapView>

      {/* Top overlay — search pill */}
      <View
        style={{ position: "absolute", top: insets.top + 8, left: 0, right: 0 }}
        className="px-4"
      >
        <SearchPill
          primary={search.query || "All treatments"}
          secondary={search.locationLabel}
          onOpenFilters={() => drawerRef.current?.open()}
        />
      </View>

      {/* Bottom sheet */}
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={{ backgroundColor: "#FFFFFF" }}
        handleIndicatorStyle={{ backgroundColor: "#B6AE96" }}
      >
        <FilterChips
          activeKey={activeCategory}
          onPickCategory={setActiveCategory}
          onOpenFilters={() => drawerRef.current?.open()}
        />
        <View className="px-4 pt-3 pb-1 bg-white">
          <Text className="text-ink-800 text-base font-semibold">
            {filtered.length} {filtered.length === 1 ? "venue" : "venues"} nearby
          </Text>
        </View>
        <BottomSheetFlashList
          // @gorhom/bottom-sheet's forwardRef erases the inner FlashList's
          // ref shape; cast through unknown so our minimal scrollToIndex
          // interface (declared on listRef) is what survives at the call site.
          ref={listRef as unknown as React.Ref<React.FC<unknown>>}
          data={filtered}
          keyExtractor={(b) => b.place_id}
          estimatedItemSize={120}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          extraData={selectedId}
          renderItem={({ item, index }) => (
            <VenueCard
              business={item}
              variant="wide"
              highlighted={index === indexOfSelected}
            />
          )}
        />
      </BottomSheet>

      <FilterDrawer
        ref={drawerRef}
        initial={filterValue}
        onApply={onApplyFilters}
      />
    </View>
  );
}
