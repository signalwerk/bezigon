// Transport only. All Bezigon rules remain in the unmodified 4.2.0 source.
// Each call reconstructs a temporary path; the TypeScript app owns editor state.
#include "bezigon.h"

// Row: x, y, type, cusp, manual-in, manual-out, in-x, in-y, out-x, out-y,
//      in-axis-x, in-axis-y, out-axis-x, out-axis-y, has-in-axis, has-out-axis.
extern "C" int bg_run(double* data, int count, int close, int operation,
                      int index, double a, double b)
{
    using namespace bezigon;
    const int stride = 16;
    Path path;
    for (int i = 0; i < count; ++i) {
        double* row = data + i * stride;
        path.nodes.push_back(make_node(row[0], row[1], static_cast<NodeType>(int(row[2]))));
    }
    if (close != 0) close_path(path, close == 2);
    // Restore exact edited fields AFTER establishing the close state. Replaying
    // a modifier close must not undo a later conversion of the start node.
    for (int i = 0; i < count; ++i) {
        double* row = data + i * stride;
        Node& n = path.nodes[i];
        n.type = static_cast<NodeType>(int(row[2]));
        n.cusp = row[3] != 0;
        n.manual_in = row[4] != 0; n.manual_out = row[5] != 0;
        n.hx_in = row[6]; n.hy_in = row[7];
        n.hx_out = row[8]; n.hy_out = row[9];
    }
    switch (operation) {
    case 1: set_node_type(path, index, static_cast<NodeType>(int(a))); break;
    case 2: drag_handle(path, index, true, a, b); break;
    case 3: drag_handle(path, index, false, a, b); break;
    case 4: close_path(path, false); compute_handles(path); break;
    case 5: close_path(path, true); compute_handles(path); break;
    default: compute_handles(path); break;
    }
    for (int i = 0; i < count; ++i) {
        double* row = data + i * stride;
        const Node& n = path.nodes[i];
        row[0] = n.x; row[1] = n.y; row[2] = static_cast<int>(n.type);
        row[3] = n.cusp; row[4] = n.manual_in; row[5] = n.manual_out;
        row[6] = n.hx_in; row[7] = n.hy_in;
        row[8] = n.hx_out; row[9] = n.hy_out;
        row[10] = row[11] = row[12] = row[13] = row[14] = row[15] = 0;
        if (n.type == NodeType::Tangent) {
            row[14] = handle_axis(path, i, true, row[10], row[11]);
            row[15] = handle_axis(path, i, false, row[12], row[13]);
        }
    }
    return static_cast<int>(path.close());
}
