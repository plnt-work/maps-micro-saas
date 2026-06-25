// Root layout. Hosts the React Query client, the gesture handler root
// view (needed by @gorhom/bottom-sheet), and the route stack. NativeWind
// is enabled globally via the import of global.css.
import "react-native-url-polyfill/auto";
import "../global.css";

import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="venue/[placeId]/index"
              options={{ headerShown: true, headerTitle: "" }}
            />
            <Stack.Screen
              name="venue/[placeId]/book"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="venue/[placeId]/assistant"
              options={{
                presentation: "transparentModal",
                animation: "fade",
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="search"
              options={{ presentation: "modal", animation: "slide_from_bottom" }}
            />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
