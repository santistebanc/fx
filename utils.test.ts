import { test, expect } from "bun:test"
import { euroDisplayTextToCents, listItemPriceCents, priceCentsFromDataPriceAttr } from "./utils"

test("priceCentsFromDataPriceAttr", () => {
  expect(priceCentsFromDataPriceAttr(undefined)).toBeNull()
  expect(priceCentsFromDataPriceAttr("36100")).toBe(36100)
  expect(priceCentsFromDataPriceAttr("")).toBeNull()
})

test("euroDisplayTextToCents plain euros", () => {
  expect(euroDisplayTextToCents("€361")).toBe(36100)
  expect(euroDisplayTextToCents("€ 145")).toBe(14500)
})

test("euroDisplayTextToCents thousands separators", () => {
  expect(euroDisplayTextToCents("€1.234")).toBe(123400)
  expect(euroDisplayTextToCents("€12.345")).toBe(1234500)
})

test("euroDisplayTextToCents decimal fractions", () => {
  expect(euroDisplayTextToCents("€99.99")).toBe(9999)
  expect(euroDisplayTextToCents("€99,99")).toBe(9999)
})

test("euroDisplayTextToCents EU combined thousands + cents", () => {
  expect(euroDisplayTextToCents("€1.234,56")).toBe(123456)
})

test("euroDisplayTextToCents US combined thousands + cents", () => {
  expect(euroDisplayTextToCents("€1,234.56")).toBe(123456)
})

test("listItemPriceCents prefers data-price", () => {
  expect(listItemPriceCents("36100", "€999")).toBe(36100)
  expect(listItemPriceCents(undefined, "€361")).toBe(36100)
})
