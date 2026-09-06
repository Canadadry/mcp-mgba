cmake_minimum_required(VERSION 3.16)
project(mcbamgba_shim C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(NOT CMAKE_BUILD_TYPE)
	set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

set(MGBA_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/vendor/mgba")

if(NOT EXISTS "${MGBA_SOURCE_DIR}/CMakeLists.txt")
	message(FATAL_ERROR
		"libmgba submodule is missing at native/vendor/mgba.\n"
		"Run: git submodule update --init --recursive")
endif()

# --- Headless libmgba build ---------------------------------------------
# LIBMGBA_ONLY builds just the core library: no Qt/SDL frontends, no
# X11/OpenGL, no display of any kind (DISABLE_FRONTENDS=ON, DISABLE_DEPS=ON
# under the hood). It normally *also* forces a static-only build
# (BUILD_STATIC=ON/BUILD_SHARED=OFF) via plain `set()` calls in mGBA's
# CMakeLists.txt that shadow any `-DBUILD_SHARED=ON` passed on the command
# line - see native/patches/0001-libmgba-only-shared.patch, which build.sh
# applies to the vendored checkout so a real .so/.dylib actually comes out.
set(LIBMGBA_ONLY ON CACHE BOOL "" FORCE)
set(BUILD_SHARED ON CACHE BOOL "" FORCE)
set(BUILD_STATIC OFF CACHE BOOL "" FORCE)

# Not covered by LIBMGBA_ONLY's defaults: the debugger vtable
# (mDebuggerPlatform, breakpoints/watchpoints/registers) is only compiled
# in when USE_DEBUGGERS is on, and it defaults on only in the non-headless
# branch of mGBA's CMakeLists.txt. The shim needs it.
set(USE_DEBUGGERS ON CACHE BOOL "" FORCE)

set(M_CORE_GBA ON CACHE BOOL "" FORCE)
set(M_CORE_GB OFF CACHE BOOL "" FORCE)
set(BUILD_TEST OFF CACHE BOOL "" FORCE)

add_subdirectory("${MGBA_SOURCE_DIR}" mgba-build)

# Empirically verify the shared-lib override actually took effect, per the
# PRD's explicit warning that LIBMGBA_ONLY's forced-static behavior is the
# single biggest risk in this milestone.
get_target_property(_mgba_target_type mgba TYPE)
if(NOT _mgba_target_type STREQUAL "SHARED_LIBRARY")
	message(FATAL_ERROR
		"libmgba built as ${_mgba_target_type}, not SHARED_LIBRARY. "
		"LIBMGBA_ONLY's forced-static override was not defeated - confirm "
		"native/patches/0001-libmgba-only-shared.patch is applied to "
		"native/vendor/mgba/CMakeLists.txt (native/build.sh applies it "
		"automatically; a manual `cmake` invocation must apply it first).")
endif()

# --- The shim itself ------------------------------------------------------
add_library(mcbamgba_shim SHARED shim.c shim.h)
target_link_libraries(mcbamgba_shim PRIVATE mgba)
target_compile_definitions(mcbamgba_shim PRIVATE USE_DEBUGGERS)
set_target_properties(mcbamgba_shim PROPERTIES
	OUTPUT_NAME "mcbamgba_shim"
	C_VISIBILITY_PRESET default
)

install(TARGETS mcbamgba_shim mgba
	LIBRARY DESTINATION lib
	RUNTIME DESTINATION lib
)

# --- Smoke test -------------------------------------------------------------
enable_testing()
add_executable(mcbamgba_smoke_test test/smoke_test.c)
target_link_libraries(mcbamgba_smoke_test PRIVATE mcbamgba_shim)
target_include_directories(mcbamgba_smoke_test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
add_test(NAME smoke_test COMMAND mcbamgba_smoke_test
	"${CMAKE_CURRENT_SOURCE_DIR}/../test/fixtures/rom/build/fixture.gba")
