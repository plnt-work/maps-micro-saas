// Hero carousel for the venue detail page. In P1 there are no real
// photos on Business records — we render a vertical-colored placeholder
// per slot so the layout reads. When MA-P3/P6 photo URIs ship, swap in
// expo-image without changing the parent.
import { useState } from "react";
import { Dimensions, View } from "react-native";
import { Image } from "expo-image";
import type { Business } from "@web/places/types";
import { metaFor } from "@web/places/verticals";

interface Props {
  business: Business;
}

const { width: SCREEN } = Dimensions.get("window");
const SLOTS = 3;

export function VenueHero({ business }: Props) {
  const [index, setIndex] = useState(0);
  const meta = metaFor(business.vertical);
  const photo = business.photo_uri;

  return (
    <View>
      <View style={{ width: SCREEN, height: SCREEN * 0.6 }}>
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={{ width: SCREEN, height: SCREEN * 0.6 }}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View
            className="flex-1 items-center justify-center"
            style={{ backgroundColor: meta.color }}
          />
        )}
      </View>
      <View className="flex-row justify-center gap-2 mt-2">
        {Array.from({ length: SLOTS }).map((_, i) => (
          <View
            key={i}
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: i === index ? "#0E1116" : "#D8CFB4" }}
            onTouchEnd={() => setIndex(i)}
          />
        ))}
      </View>
    </View>
  );
}
