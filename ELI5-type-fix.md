# ELI5: The `as const` Type Fix

## The problem

Imagine you have a box of crayons. The box is labeled **"crayons"**.

When you pick up the red crayon and show it to a friend, you could describe it two ways:
- "This is a **crayon**." (vague — could be any color)
- "This is a **red** crayon." (specific — exactly the one you're holding)

TypeScript did the vague version. We needed the specific one.

---

## What was happening

```ts
type: ApplicationCommandOptionType.Integer
```

`ApplicationCommandOptionType` is an enum — a named list of options like:
```
String = 3
Integer = 4
Boolean = 5
User = 6
... and more
```

When TypeScript sees `ApplicationCommandOptionType.Integer`, it knows the *value* is `4`. But it describes the *type* as `ApplicationCommandOptionType` — meaning "some value from this enum, could be any of them." That's the vague crayon.

Carbon's command system is strict. It says: **"I only accept specific types — String, Integer, Boolean, etc. I will NOT accept just 'some enum value'."**

So TypeScript complained: *"You gave me a crayon, but I need a RED crayon specifically."*

---

## The fix

```ts
type: ApplicationCommandOptionType.Integer as const
```

`as const` tells TypeScript: **"Don't widen this. Keep it exactly as the literal value I wrote."**

Now instead of saying "this is some enum value", TypeScript says "this is specifically `ApplicationCommandOptionType.Integer`." Carbon is happy, because that's exactly what it asked for.

---

## One-liner summary

> `as const` tells TypeScript "I mean exactly this value, stop being vague about it."
