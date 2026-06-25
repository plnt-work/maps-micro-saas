export type Vertical =
  | "restaurant"
  | "doctor"
  | "salon"
  | "pharmacy"
  | "gym";

export interface Business {
  place_id: string;
  display_name: string;
  vertical: Vertical;
  lat: number;
  lng: number;
  address: string;
  rating: number;
  user_ratings: number;
  photo_uri?: string;
  hours?: string;
  phone?: string;
  web?: string;
}
