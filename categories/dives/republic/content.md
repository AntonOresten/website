---
title: Republic.jl
description: On Julia's `public` keyword
date: 2026-02-23
---

Julia 1.11 introduced the `public` keyword. It was a good idea — a way to say "this name is part of the API, but I don't want it dumped into your namespace when you write `using MyPackage`." Exported names get pulled in automatically; public names are accessible only through qualified access like `MyPackage.frobnicate`. Clean separation of API surface from namespace pollution.

In practice, though, `public` has been a bit of a wallflower. Most packages still just `export` everything they want users to touch, and the public-but-not-exported distinction has felt more theoretical than useful. What would actually make it matter?

Turns out, the answer is composability. Specifically: what happens when your package is a thin wrapper around someone else's API?

## The Problem

Suppose you're building `MyPackage`, which mostly re-exposes functionality from `Foo`. With `export`, you'd use [Reexport.jl](https://github.com/JuliaLang/Reexport.jl):

```julia
module MyPackage
    using Reexport
    @reexport using Foo              # whole module
    @reexport using Foo: frobnicate  # or specific names
end
```

Reexport works great, and it handles both whole-module and specific-name forms. But the result is always *export* — every re-exposed name gets pulled into scope when someone writes `using MyPackage`.

What if you'd rather expose a broad API surface *without* the namespace dump? That's exactly the niche `public` was designed for. You want `Foo`'s API to be accessible as `MyPackage.bar`, `MyPackage.baz`, etc., without `bar` and `baz` showing up as bare names when someone writes `using MyPackage`.

But there was no equivalent of Reexport for `public`. Until now.

## Enter Republic.jl

[Republic.jl](https://github.com/MurrellGroup/Republic.jl) does for `public` what Reexport.jl does for `export`. The name is a unapologetically a pun.

```julia
module MyPackage
    using Republic
    @republic using Foo
end
```

This takes every name that `Foo` has marked as `public` or `export`ed and marks it `public` in `MyPackage`. That's it. Your users get access to the full API through qualified names, without a single unsolicited import.

It supports all the `using`/`import` forms you'd expect:

```julia
@republic using Foo: bar, baz       # specific names
@republic using Foo: Foo as F       # aliases
@republic begin                     # blocks
    using Foo
    using Bar
end
```

## The Key Insight: Reflecting on Visibility

Here's what makes this possible and, I think, what makes `public` actually interesting as a language feature. At macro expansion time, you can have `Base.ispublic(upstream, name)` and `Base.isexported(upstream, name)` to ask: *how did the upstream module classify this name?*

This means Republic.jl can distinguish between names that were `export`ed upstream and names that were merely `public`. That distinction enables a richer re-publishing strategy than simple re-export.

By default, `@republic` flattens everything to `public` — a conservative choice that says "I'm exposing the API, not making namespace decisions for my users." But with `reexport=true`, it *preserves* the upstream visibility: names that were `export`ed upstream get re-exported, while `public`-only names stay `public`.

```julia
# Conservative: everything becomes public
@republic using Foo

# Faithful: preserves upstream's export/public distinction
@republic reexport=true using Foo
```

This is a genuinely useful semantic distinction that didn't exist before `public`, and it only becomes practical once you have tooling that reflects on it.

## Overriding Visibility

Republic.jl also handles the awkward edge case where you want to *promote* a name's visibility. Julia doesn't allow a name to be both `public` and `export`ed, and will error if you try. If some name is `public`-only upstream but you want to `export` it from your module, you declare the `export` first:

```julia
module MyPackage
    using Republic
    export bar               # I want this exported
    @republic using Foo      # skips `public` for bar, since it's already exported
end
```

Republic.jl checks existing declarations and avoids the conflict. It's a small thing, but it saves you from an annoying class of "public after export" errors.

## Why Bother?

To be clear: you could always do this by hand. Import each name, write `public name1, name2, ...`, and you're done. Republic.jl doesn't enable anything new. `@republic` is a convenience macro that enables wildcard re-`public`. The same was true of Reexport.jl when it appeared over a decade ago. You could always write `export` statements manually. But Reexport made re-exporting a one-liner, and that small ergonomic improvement was enough to become ubiquitous. It's been stable for years with essentially no changes needed. It's a well-scoped tool that does exactly one thing.

Republic.jl aims to be the same kind of thing for `public`. The actual work is trivial; what matters is that it's trivial to *express*. When propagating an upstream API is a one-liner, you're more likely to actually use `public` for API layering — and that, somewhat circuitously, is what gives `public` a reason to exist.

The implementation is fairly straightforward, but getting it *correct* required some thought. `public` has specific semantics — you can't mark a name `public` after it's been `export`ed, or vice versa; public-only names from upstream aren't brought in by `using` and need explicit imports; and different `using`/`import` forms interact with visibility in subtly different ways. None of these are hard problems individually, but a convenience macro that silently gets them wrong would be worse than no macro at all.

The broader point is about API composition. Julia's ecosystem is full of packages that wrap or aggregate other packages into a coherent interface. `export` was the only tool for propagating names across those boundaries, and it forces a binary choice: dump the name into every user's namespace, or keep it internal. `public` added a middle ground, but the ergonomics of manually propagating it across module boundaries meant few packages bothered. Republic.jl is a bet that removing that friction matters.

The package is available at [MurrellGroup/Republic.jl](https://github.com/MurrellGroup/Republic.jl). It's derived from Reexport.jl, and the implementation is roughly as simple as you'd hope — a macro that walks `using`/`import` forms, queries upstream visibility, and emits the appropriate `public` or `export` declarations.