cmake_minimum_required(VERSION 3.20)
project(bitscope_h264_inspector VERSION 0.1.0 LANGUAGES CXX)

include(GNUInstallDirs)

option(BITSCOPE_ENABLE_SANITIZERS "Enable AddressSanitizer and UndefinedBehaviorSanitizer" OFF)

find_package(PkgConfig REQUIRED)
pkg_check_modules(FFMPEG REQUIRED IMPORTED_TARGET libavcodec libavutil)

add_library(bitscope_h264_inspector STATIC src/inspector.cpp)
target_include_directories(bitscope_h264_inspector PUBLIC include)
target_link_libraries(bitscope_h264_inspector PUBLIC PkgConfig::FFMPEG)
target_compile_features(bitscope_h264_inspector PUBLIC cxx_std_20)

add_executable(bitscope-h264-inspect src/main.cpp)
target_link_libraries(bitscope-h264-inspect PRIVATE bitscope_h264_inspector)

install(TARGETS bitscope_h264_inspector bitscope-h264-inspect
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES include/bitscope_h264_inspector.h DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})

if(MSVC)
  target_compile_options(bitscope_h264_inspector PRIVATE /W4 /WX /sdl)
  target_compile_options(bitscope-h264-inspect PRIVATE /W4 /WX /sdl)
else()
  foreach(target bitscope_h264_inspector bitscope-h264-inspect)
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Werror -fstack-protector-strong)
  endforeach()
  if(BITSCOPE_ENABLE_SANITIZERS)
    foreach(target bitscope_h264_inspector bitscope-h264-inspect)
      target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
      target_link_options(${target} PRIVATE -fsanitize=address,undefined)
    endforeach()
  endif()
endif()
