shader_type canvas_item;
uniform float opening : hint_range(0.0, 1.0) = 0.0;
varying vec4 gate_tint;

void vertex() {
	gate_tint = COLOR;
}

void fragment() {
	vec2 source_uv = UV + vec2(0.0, opening);
	COLOR = texture(TEXTURE, source_uv) * gate_tint;
	if (source_uv.y >= 1.0) {
		COLOR.a = 0.0;
	}
}
