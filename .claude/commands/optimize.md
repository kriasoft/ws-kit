Analyze the provided code for performance issues and suggest optimizations: $ARGUMENTS

Focus on these areas specific to the ws-kit project:

## Performance Analysis Areas

1. **Message Validation**
   - Zod schema validation overhead
   - JSON parse/stringify frequency
   - Schema compilation and caching

2. **Memory Management**
   - Object creation in hot paths
   - Handler storage efficiency
   - Connection data structure

3. **WebSocket Operations**
   - Message routing efficiency
   - Handler lookup performance
   - Connection lifecycle management

4. **Type System Impact**
   - Complex conditional types compilation time
   - Runtime type checking overhead
   - Type assertion costs

## Optimization Suggestions Format

For each identified issue, provide:

- **Issue**: Description of the performance problem
- **Impact**: Estimated performance impact (High/Medium/Low)
- **Solution**: Specific code changes with examples
- **Trade-offs**: Any downsides to the optimization
- **Compatibility**: Impact on existing API

## Benchmarking Recommendations

Suggest specific benchmarks to measure:

- Messages per second throughput
- Connection setup/teardown time
- Memory usage patterns
- Schema validation performance

## Code Quality Considerations

Also evaluate:

- Code readability vs performance
- Maintainability impact
- Bundle size implications
- Runtime error patterns
