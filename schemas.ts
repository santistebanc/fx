import { Schema, DateTime, Effect } from "effect"

/**
 * ISO date format validator (YYYY-MM-DD)
 */
const IsoDateSchema = Schema.String.pipe(
  Schema.filter((date) => {
    const regex = /^\d{4}-\d{2}-\d{2}$/
    if (!regex.test(date)) return false
    // Use Effect DateTime to parse and validate
    const parsed = DateTime.make(date + "T00:00:00Z")
    return parsed._tag === "Some"
  }, {
    message: () => "Expected ISO date string in format YYYY-MM-DD",
  })
)

/**
 * Time format validator (HH:MM)
 */
const TimeSchema = Schema.String.pipe(
  Schema.filter((time) => {
    const regex = /^([01]\d|2[0-3]):([0-5]\d)$/
    return regex.test(time)
  }, {
    message: () => "Expected time string in format HH:MM",
  })
)

/**
 * ISO timestamp format validator
 */
const IsoTimestampSchema = Schema.String.pipe(
  Schema.filter((timestamp) => {
    // Use Effect DateTime to parse and validate
    const parsed = DateTime.make(timestamp)
    return parsed._tag === "Some"
  }, {
    message: () => "Expected ISO timestamp string",
  })
)

/**
 * Airport code validator (IATA format: 3 uppercase letters)
 */
const AirportCodeSchema = Schema.String.pipe(
  Schema.filter((code) => {
    const regex = /^[A-Z]{3}$/
    return regex.test(code)
  }, {
    message: () => "Expected IATA airport code (3 uppercase letters)",
  })
)

/**
 * SearchInput schema
 */
export const SearchInputSchema = Schema.Struct({
  origin: AirportCodeSchema, // Origin airport code
  destination: AirportCodeSchema, // Destination airport code
  departureDate: IsoDateSchema, // ISO date string (YYYY-MM-DD)
  returnDate: Schema.optional(IsoDateSchema), // ISO date string (YYYY-MM-DD) - optional
})

export type SearchInput = Schema.Schema.Type<typeof SearchInputSchema>

/**
 * Result type containing arrays of deals, flights, legs, and trips
 */
export interface ParsedDealsData {
  deals: Deal[]
  flights: Flight[]
  legs: Leg[]
  trips: Trip[]
}

/**
 * Search result containing parsed data and metadata
 */
export interface SearchResult {
  data: ParsedDealsData
  metadata: {
    numberOfDeals: number
    numberOfFlights: number
    numberOfLegs: number
    numberOfTrips: number
    pollRetries: number
    errors: string[]
    timeSpentMs: number
  }
}

/**
 * Deal class
 */
export class Deal extends Schema.Class<Deal>("Deal")({
  id: Schema.String,
  trip: Schema.String,
  origin: AirportCodeSchema,
  destination: AirportCodeSchema,
  departure_date: IsoDateSchema, // ISO date string (YYYY-MM-DD)
  departure_time: TimeSchema, // Time string (HH:MM)
  return_date: Schema.NullOr(IsoDateSchema), // ISO date string (YYYY-MM-DD) or null
  return_time: Schema.NullOr(TimeSchema), // Time string (HH:MM) or null
  source: Schema.String,
  provider: Schema.String,
  price: Schema.Number, // float (real)
  link: Schema.String,
  created_at: IsoTimestampSchema, // ISO timestamp string
  updated_at: IsoTimestampSchema, // ISO timestamp string
}) {
  /**
   * Returns whether this is a round trip deal (checks if return_date exists)
   */
  isRoundTrip(this: Deal): boolean {
    return this.return_date !== null
  }

  /**
   * Calculates the departure DateTime by combining departure_date and departure_time
   */
  departure(this: Deal): Effect.Effect<DateTime.DateTime, Error> {
    const isoString = `${this.departure_date}T${this.departure_time}:00Z`
    const parsed = DateTime.make(isoString)
    if (parsed._tag === "None") {
      return Effect.fail(
        new Error(`Invalid departure date/time: ${this.departure_date} ${this.departure_time}`)
      )
    }
    return Effect.succeed(parsed.value)
  }

  /**
   * Calculates the return DateTime by combining return_date and return_time (if both are present)
   */
  returnDateTime(this: Deal): Effect.Effect<DateTime.DateTime | null, Error> {
    if (this.return_date === null || this.return_time === null) {
      return Effect.succeed(null)
    }
    const isoString = `${this.return_date}T${this.return_time}:00Z`
    const parsed = DateTime.make(isoString)
    if (parsed._tag === "None") {
      return Effect.fail(
        new Error(`Invalid return date/time: ${this.return_date} ${this.return_time}`)
      )
    }
    return Effect.succeed(parsed.value)
  }

  /**
   * Parses the created_at timestamp into a DateTime
   */
  createdAt(this: Deal): Effect.Effect<DateTime.DateTime, Error> {
    const parsed = DateTime.make(this.created_at)
    if (parsed._tag === "None") {
      return Effect.fail(new Error(`Invalid created_at timestamp: ${this.created_at}`))
    }
    return Effect.succeed(parsed.value)
  }

  /**
   * Parses the updated_at timestamp into a DateTime
   */
  updatedAt(this: Deal): Effect.Effect<DateTime.DateTime, Error> {
    const parsed = DateTime.make(this.updated_at)
    if (parsed._tag === "None") {
      return Effect.fail(new Error(`Invalid updated_at timestamp: ${this.updated_at}`))
    }
    return Effect.succeed(parsed.value)
  }
}

/**
 * Deal schema (exported for convenience)
 * The Deal class itself can be used as a schema
 */
export const DealSchema = Deal

/**
 * Flight class
 */
export class Flight extends Schema.Class<Flight>("Flight")({
  id: Schema.String,
  flight_number: Schema.String,
  airline: Schema.String,
  origin: AirportCodeSchema,
  destination: AirportCodeSchema,
  departure_date: IsoDateSchema, // ISO date string (YYYY-MM-DD)
  departure_time: TimeSchema, // Time string (HH:MM)
  arrival_date: IsoDateSchema, // ISO date string (YYYY-MM-DD)
  arrival_time: TimeSchema, // Time string (HH:MM)
  duration: Schema.Number, // smallint (minutes)
  created_at: IsoTimestampSchema, // ISO timestamp string
}) {
  /**
   * Calculates the departure DateTime by combining departure_date and departure_time
   */
  departure(this: Flight): Effect.Effect<DateTime.DateTime, Error> {
    const isoString = `${this.departure_date}T${this.departure_time}:00Z`
    const parsed = DateTime.make(isoString)
    if (parsed._tag === "None") {
      return Effect.fail(
        new Error(`Invalid departure date/time: ${this.departure_date} ${this.departure_time}`)
      )
    }
    return Effect.succeed(parsed.value)
  }

  /**
   * Calculates the arrival DateTime by combining arrival_date and arrival_time
   */
  arrival(this: Flight): Effect.Effect<DateTime.DateTime, Error> {
    const isoString = `${this.arrival_date}T${this.arrival_time}:00Z`
    const parsed = DateTime.make(isoString)
    if (parsed._tag === "None") {
      return Effect.fail(
        new Error(`Invalid arrival date/time: ${this.arrival_date} ${this.arrival_time}`)
      )
    }
    return Effect.succeed(parsed.value)
  }

  /**
   * Parses the created_at timestamp into a DateTime
   */
  createdAt(this: Flight): Effect.Effect<DateTime.DateTime, Error> {
    const parsed = DateTime.make(this.created_at)
    if (parsed._tag === "None") {
      return Effect.fail(new Error(`Invalid created_at timestamp: ${this.created_at}`))
    }
    return Effect.succeed(parsed.value)
  }
}

/**
 * Flight schema (exported for convenience)
 * The Flight class itself can be used as a schema
 */
export const FlightSchema = Flight

/**
 * Leg class
 */
export class Leg extends Schema.Class<Leg>("Leg")({
  id: Schema.String,
  trip: Schema.String, // Foreign key → trips.id
  flight: Schema.String, // Foreign key → flights.id
  inbound: Schema.Boolean,
  order: Schema.Number, // Order within the trip (0-based)
  connection_time: Schema.NullOr(Schema.Number), // Minutes between flights, or null for last leg
  created_at: IsoTimestampSchema, // ISO timestamp string
}) {
  /**
   * Parses the created_at timestamp into a DateTime
   */
  createdAt(this: Leg): Effect.Effect<DateTime.DateTime, Error> {
    const parsed = DateTime.make(this.created_at)
    if (parsed._tag === "None") {
      return Effect.fail(new Error(`Invalid created_at timestamp: ${this.created_at}`))
    }
    return Effect.succeed(parsed.value)
  }
}

/**
 * Leg schema (exported for convenience)
 * The Leg class itself can be used as a schema
 */
export const LegSchema = Leg

/**
 * Trip class
 */
export class Trip extends Schema.Class<Trip>("Trip")({
  id: Schema.String, // Generated as: SHA-256 hash of sorted flight IDs joined by `|`
  created_at: IsoTimestampSchema, // ISO timestamp string
}) {
  /**
   * Parses the created_at timestamp into a DateTime
   */
  createdAt(this: Trip): Effect.Effect<DateTime.DateTime, Error> {
    const parsed = DateTime.make(this.created_at)
    if (parsed._tag === "None") {
      return Effect.fail(new Error(`Invalid created_at timestamp: ${this.created_at}`))
    }
    return Effect.succeed(parsed.value)
  }
}

/**
 * Trip schema (exported for convenience)
 * The Trip class itself can be used as a schema
 */
export const TripSchema = Trip
