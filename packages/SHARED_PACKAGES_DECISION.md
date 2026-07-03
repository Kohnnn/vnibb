# VNIBB Shared Package - Decision Record

## Status: DOCUMENTED STUB (No Action Required)

Per the refactoring plan Phase 6, after analysis the shared packages have been determined to be **intentional future-extraction stubs**.

---

## Decision: Keep Stubs with Clear Documentation

### Rationale

1. **Shared Types (`packages/shared`)**: 
   - The frontend and backend use different type systems (TypeScript vs Pydantic)
   - Real shared code would require careful abstraction
   - Current types are well-organized in `apps/web/src/types` and `apps/api/vnibb/models`

2. **UI Components (`packages/ui`)**:
   - Frontend uses Tailwind + custom components in `apps/web/src/components/ui`
   - Design system is working well without extraction
   - No need to extract what isn't duplicated

3. **Widgets (`packages/widgets`)**:
   - All widgets live in `apps/web/src/components/widgets` (148+ widgets)
   - Works well as part of the monorepo
   - Could be extracted later if standalone package is needed

### Future Extraction Path

If extraction becomes necessary in the future:

1. **Phase 1**: Identify actual shared code through dependency analysis
2. **Phase 2**: Create proper abstraction layer (not just moving files)
3. **Phase 3**: Update imports and test integration
4. **Phase 4**: Publish packages to npm with proper versioning

### Current Structure

```
packages/
├── shared/     # Types stub - keep for future extraction
├── ui/          # Components stub - keep for future extraction  
├── widgets/     # Widgets stub - keep for future extraction
└── providers/   # Python providers - already real code
```

---

## Summary

✅ **No action required.** All shared packages are documented stubs with clear intent.
✅ **Keep as-is** with clear README documentation.
✅ **Ready for future extraction** when/if actual shared code emerges.
