# Cache broker ordering

Worker cache RPC reaches the main-thread IndexedDB broker asynchronously. The broker processes requests in arrival order so `clear` is a barrier: every earlier operation completes before the clear, and later operations start afterward.

Worker requests also have a configured timeout. Cache writes carry the same deadline to the broker. A write that expires before or during commit is rejected and conditionally rolled back by exact record identity.
